// Business profile, tax rules and their verification, and operational settings.
import type { Prisma } from "@prisma/client";
import type { Db } from "../db.js";
import { percentToBasisPoints } from "../domain/billing.js";
import { audit } from "../lib/audit.js";
import { badRequest, notFound } from "../lib/errors.js";
import { SETTING_DEFAULTS, type SettingKey } from "../lib/settings.js";
import { type AdminActor, assertCan } from "./actor.js";

const GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

const profileDto = (p: Prisma.BusinessProfileGetPayload<object> | null) =>
  p
    ? {
        legalName: p.legalName,
        tradeName: p.tradeName,
        gstin: p.gstin,
        stateCode: p.stateCode,
        address: p.address,
        phone: p.phone,
        email: p.email,
        bankDetails: p.bankDetails,
        invoicePrefix: p.invoicePrefix,
        invoiceTerms: p.invoiceTerms,
        verificationStatus: p.verificationStatus,
        verifiedAt: p.verifiedAt?.toISOString() ?? null,
      }
    : { legalName: null, tradeName: null, gstin: null, stateCode: null, address: null, phone: null, email: null, bankDetails: null, invoicePrefix: "AJ", invoiceTerms: null, verificationStatus: "UNVERIFIED" as const, verifiedAt: null };

export async function getBusinessProfile(db: Db, actor: AdminActor) {
  assertCan(actor, "SETTINGS");
  return profileDto(await db.businessProfile.findUnique({ where: { id: "default" } }));
}

/** Any edit resets verification: changed details must be checked again before tax invoices are issued. */
export async function updateBusinessProfile(db: Db, actor: AdminActor, input: Partial<Omit<ReturnType<typeof profileDto>, "verificationStatus" | "verifiedAt">>) {
  assertCan(actor, "SETTINGS");
  const gstin = input.gstin?.trim().toUpperCase() || null;
  if (gstin && !GSTIN.test(gstin)) throw badRequest("INVALID_GSTIN", "GSTIN must be 15 characters in the standard format.");
  if (input.invoicePrefix !== undefined && !/^[A-Z0-9]{1,8}$/.test(input.invoicePrefix ?? "")) throw badRequest("INVALID_PREFIX", "Invoice prefix: 1–8 capital letters or digits.");
  const data = { ...input, gstin: input.gstin === undefined ? undefined : gstin, stateCode: input.stateCode ?? (gstin ? gstin.slice(0, 2) : undefined), invoicePrefix: input.invoicePrefix ?? undefined };
  return db.$transaction(async (tx) => {
    const before = await tx.businessProfile.findUnique({ where: { id: "default" } });
    const p = await tx.businessProfile.upsert({
      where: { id: "default" },
      create: { ...data, id: "default", updatedById: actor.userId, verificationStatus: "UNVERIFIED" },
      update: { ...data, updatedById: actor.userId, verificationStatus: "UNVERIFIED", verifiedById: null, verifiedAt: null },
    });
    await audit(tx, { actorId: actor.userId, action: "business_profile.updated", entityType: "BusinessProfile", entityId: "default", before: before ? JSON.parse(JSON.stringify(before)) : undefined, after: JSON.parse(JSON.stringify(p)) });
    return profileDto(p);
  });
}

export async function verifyBusinessProfile(db: Db, actor: AdminActor, confirmation: string) {
  assertCan(actor, "TAX_VERIFY");
  if (confirmation.trim().length < 10) throw badRequest("CONFIRMATION_REQUIRED", "Record how the details were verified (at least 10 characters).");
  const p = await db.businessProfile.findUnique({ where: { id: "default" } });
  if (!p?.legalName || !p.gstin || !p.address || !p.stateCode) throw badRequest("PROFILE_INCOMPLETE", "Legal name, GSTIN, state code and address are required before verification.");
  return db.$transaction(async (tx) => {
    const v = await tx.businessProfile.update({ where: { id: "default" }, data: { verificationStatus: "VERIFIED", verifiedById: actor.userId, verifiedAt: new Date() } });
    await audit(tx, { actorId: actor.userId, action: "business_profile.verified", entityType: "BusinessProfile", entityId: "default", reason: confirmation.trim() });
    return profileDto(v);
  });
}

const ruleDto = (r: Prisma.TaxRuleGetPayload<object>) => ({
  id: r.id,
  name: r.name,
  sacCode: r.sacCode,
  cgstRate: r.cgstRate?.toFixed(2) ?? null,
  sgstRate: r.sgstRate?.toFixed(2) ?? null,
  igstRate: r.igstRate?.toFixed(2) ?? null,
  notes: r.notes,
  active: r.active,
  verificationStatus: r.verificationStatus,
  verifiedAt: r.verifiedAt?.toISOString() ?? null,
});

export async function listTaxRules(db: Db, actor: AdminActor) {
  if (!actor.permissions.has("SETTINGS") && !actor.permissions.has("INVOICES")) assertCan(actor, "SETTINGS");
  return (await db.taxRule.findMany({ orderBy: [{ active: "desc" }, { name: "asc" }] })).map(ruleDto);
}

function rate(v: string | null | undefined) {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const bp = percentToBasisPoints(v);
  if (bp > 5000) throw badRequest("INVALID_RATE", "A tax rate above 50% is not valid.");
  return v;
}

/** Tax rules are entered by the accountant; nothing is preset. Saving always leaves the rule UNVERIFIED. */
export async function saveTaxRule(db: Db, actor: AdminActor, id: string | null, input: { name?: string; sacCode?: string | null; cgstRate?: string | null; sgstRate?: string | null; igstRate?: string | null; notes?: string | null; active?: boolean }) {
  assertCan(actor, "SETTINGS");
  if (!id && !input.name?.trim()) throw badRequest("NAME_REQUIRED", "Name the tax rule.");
  let data;
  try {
    data = { name: input.name?.trim(), sacCode: input.sacCode, cgstRate: rate(input.cgstRate), sgstRate: rate(input.sgstRate), igstRate: rate(input.igstRate), notes: input.notes, active: input.active };
  } catch (e) {
    throw badRequest("INVALID_RATE", (e as Error).message);
  }
  if ((data.cgstRate === null) !== (data.sgstRate === null) && data.cgstRate !== undefined && data.sgstRate !== undefined) throw badRequest("CGST_SGST_PAIR", "Enter both CGST and SGST, or neither.");
  return db.$transaction(async (tx) => {
    const r = id
      ? await tx.taxRule.update({ where: { id }, data: { ...data, verificationStatus: "UNVERIFIED", verifiedById: null, verifiedAt: null } })
      : await tx.taxRule.create({ data: { ...data, name: data.name!, createdById: actor.userId } });
    await audit(tx, { actorId: actor.userId, action: id ? "tax_rule.updated" : "tax_rule.created", entityType: "TaxRule", entityId: r.id, after: JSON.parse(JSON.stringify(input)) });
    return ruleDto(r);
  });
}

export async function verifyTaxRule(db: Db, actor: AdminActor, id: string, confirmation: string) {
  assertCan(actor, "TAX_VERIFY");
  if (confirmation.trim().length < 10) throw badRequest("CONFIRMATION_REQUIRED", "Record who confirmed this treatment and how (at least 10 characters).");
  const r = await db.taxRule.findUnique({ where: { id } });
  if (!r) throw notFound("Tax rule");
  if (!r.cgstRate && !r.igstRate) throw badRequest("NO_RATES", "Enter the tax rates before verifying.");
  return db.$transaction(async (tx) => {
    const v = await tx.taxRule.update({ where: { id }, data: { verificationStatus: "VERIFIED", verifiedById: actor.userId, verifiedAt: new Date() } });
    await audit(tx, { actorId: actor.userId, action: "tax_rule.verified", entityType: "TaxRule", entityId: id, reason: confirmation.trim() });
    return ruleDto(v);
  });
}

const EDITABLE: SettingKey[] = ["meter.maxJobHours", "meter.elapsedToleranceHours", "contact.dispatchPhone", "contact.payrollPhone", "contact.emergencyPhone", "storage.photoQuotaGb"];

export async function getAppSettings(db: Db, actor: AdminActor) {
  assertCan(actor, "SETTINGS");
  const rows = await db.appSetting.findMany({ where: { key: { in: EDITABLE } } });
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return EDITABLE.map((key) => ({ key, value: (stored[key] as string | null | undefined) ?? SETTING_DEFAULTS[key], isDefault: !(key in stored) }));
}

export async function updateAppSetting(db: Db, actor: AdminActor, key: string, value: string | null) {
  assertCan(actor, "SETTINGS");
  if (!EDITABLE.includes(key as SettingKey)) throw badRequest("UNKNOWN_SETTING", "This setting cannot be changed here.");
  if (key.startsWith("meter.") && (value === null || !/^\d{1,3}(\.\d)?$/.test(value))) throw badRequest("INVALID_VALUE", "Enter hours as a number, e.g. 16 or 0.5.");
  if (key === "storage.photoQuotaGb" && (value === null || !/^\d{1,5}(\.\d)?$/.test(value) || Number(value) <= 0)) throw badRequest("INVALID_VALUE", "Enter the storage quota in GB, e.g. 5 or 100.");
  await db.$transaction(async (tx) => {
    const before = await tx.appSetting.findUnique({ where: { key } });
    await tx.appSetting.upsert({ where: { key }, create: { key, value: value as Prisma.InputJsonValue, updatedById: actor.userId }, update: { value: value as Prisma.InputJsonValue, updatedById: actor.userId } });
    await audit(tx, { actorId: actor.userId, action: "setting.updated", entityType: "AppSetting", entityId: key, before: before?.value as Prisma.InputJsonValue, after: value as Prisma.InputJsonValue });
  });
}

export async function auditLog(db: Db, actor: AdminActor, q: { entityType?: string; entityId?: string; page: number; pageSize: number }) {
  assertCan(actor, "SETTINGS");
  const where = { ...(q.entityType ? { entityType: q.entityType } : {}), ...(q.entityId ? { entityId: q.entityId } : {}) };
  const [rows, total] = await Promise.all([
    db.auditLog.findMany({ where, include: { actor: { select: { displayName: true, role: true } } }, orderBy: { createdAt: "desc" }, skip: (q.page - 1) * q.pageSize, take: q.pageSize }),
    db.auditLog.count({ where }),
  ]);
  return {
    items: rows.map((r) => ({ id: r.id, action: r.action, entityType: r.entityType, entityId: r.entityId, actor: r.actor ? `${r.actor.displayName} (${r.actor.role.toLowerCase()})` : "System", reason: r.reason, before: r.before, after: r.after, createdAt: r.createdAt.toISOString() })),
    total,
    page: q.page,
    pageSize: q.pageSize,
  };
}

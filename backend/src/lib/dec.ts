import { Prisma } from "@prisma/client";
import { paiseToString, parsePaise, parseTenths, tenthsToString, type Paise, type Tenths } from "../domain/units.js";

// Conversions between Prisma Decimals and the integer units the domain rules use.
export const toPaise = (d: Prisma.Decimal | null | undefined): Paise => (d ? parsePaise(d.toFixed(2))! : 0);
export const toTenths = (d: Prisma.Decimal | null | undefined): Tenths => (d ? parseTenths(d.abs().toFixed(1))! * (d.isNegative() ? -1 : 1) : 0);
export const moneyDec = (p: Paise) => new Prisma.Decimal(paiseToString(p));
export const hoursDec = (t: Tenths) => new Prisma.Decimal(tenthsToString(t));
export const money = (d: Prisma.Decimal | null | undefined) => (d ? d.toFixed(2) : null);
export const hrs = (d: Prisma.Decimal | null | undefined) => (d ? d.toFixed(1) : null);

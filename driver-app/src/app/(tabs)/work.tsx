import { useFocusEffect, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, FlatList, RefreshControl, Text, TextInput, View } from "react-native";
import { JobCard } from "@/components/JobCard";
import { AppHeader, Banner, Btn, Chips, EmptyView, ErrorView, Icon, OfflineBanner } from "@/components/ui";
import { api, ApiError } from "@/lib/api";
import { todayIst } from "@/lib/format";
import type { WorkOrderList, WorkOrderSummary } from "@/lib/types";
import { color, font, radius, space, type } from "@/theme";

type Group = "all" | "active" | "assigned" | "action" | "pending" | "approved" | "closed";
type Range = "all" | "month" | "week";
const PAGE = 20;

function rangeParams(r: Range) {
  const today = todayIst();
  if (r === "month") return { from: `${today.slice(0, 7)}-01`, to: undefined };
  if (r === "week") return { from: new Date(Date.parse(`${today}T00:00:00Z`) - 6 * 86_400_000).toISOString().slice(0, 10), to: today };
  return { from: undefined, to: undefined };
}

interface Result {
  key: string;
  items: WorkOrderSummary[];
  meta: Pick<WorkOrderList, "total" | "groupCounts"> | null;
  page: number;
  error: ApiError | null;
}

const fetchPage = (group: Group, range: Range, query: string, page: number) =>
  api.workOrders({ group: group === "all" ? undefined : group, q: query || undefined, ...rangeParams(range), page, pageSize: PAGE });

export default function MyWork() {
  const params = useLocalSearchParams<{ group?: Group }>();
  const [groupChoice, setGroupChoice] = useState<{ value: Group; fromParam?: string }>({ value: params.group ?? "all", fromParam: params.group });
  // A deep link such as "Open My Work → Needs action" selects that filter when it arrives.
  const group = params.group && params.group !== groupChoice.fromParam ? params.group : groupChoice.value;
  const setGroup = (value: Group) => setGroupChoice({ value, fromParam: params.group });

  const [range, setRange] = useState<Range>("all");
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<Result>({ key: "", items: [], meta: null, page: 1, error: null });
  const [busy, setBusy] = useState<"refreshing" | "more" | null>(null);
  const [focusTick, setFocusTick] = useState(0);
  const key = `${group}|${range}|${query}|${focusTick}`;
  const loading = result.key !== key;

  useEffect(() => {
    const t = setTimeout(() => setQuery(search.trim()), 350);
    return () => clearTimeout(t);
  }, [search]);

  useFocusEffect(useCallback(() => setFocusTick((n) => n + 1), []));

  useEffect(() => {
    let cancelled = false;
    fetchPage(group, range, query, 1).then(
      (res) => !cancelled && setResult({ key, items: res.items, meta: { total: res.total, groupCounts: res.groupCounts }, page: 1, error: null }),
      (e) => !cancelled && setResult((prev) => ({ ...prev, key, error: e as ApiError })),
    );
    return () => {
      cancelled = true;
    };
  }, [key, group, range, query]);

  const loadMore = async (mode: "refreshing" | "more") => {
    setBusy(mode);
    const page = mode === "more" ? result.page + 1 : 1;
    try {
      const res = await fetchPage(group, range, query, page);
      setResult((prev) => ({
        key,
        items: page === 1 ? res.items : [...prev.items, ...res.items],
        meta: { total: res.total, groupCounts: res.groupCounts },
        page,
        error: null,
      }));
    } catch (e) {
      setResult((prev) => ({ ...prev, error: e as ApiError }));
    } finally {
      setBusy(null);
    }
  };

  const { items, meta, error } = result;
  const c = meta?.groupCounts ?? {};
  const allCount = Object.values(c).reduce((s, n) => s + n, 0);
  const hasMore = meta ? items.length < meta.total : false;
  const showItems = loading && result.items.length === 0 ? [] : items;

  return (
    <View style={{ flex: 1, backgroundColor: color.canvas }}>
      <AppHeader title="My Work" eyebrow="Assigned duty & history" />
      <OfflineBanner />
      <FlatList
        data={showItems}
        keyExtractor={(w) => w.id}
        renderItem={({ item }) => <JobCard wo={item} />}
        contentContainerStyle={{ padding: space.gutter, gap: space.md, paddingBottom: space.xl }}
        refreshControl={<RefreshControl refreshing={busy === "refreshing"} onRefresh={() => loadMore("refreshing")} />}
        ListHeaderComponent={
          <View style={{ gap: space.md }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: space.sm, backgroundColor: color.white, borderWidth: 1.5, borderColor: color.borderStrong, borderRadius: radius.md, paddingHorizontal: 12 }}>
              <Icon name="search" tint={color.muted} />
              <TextInput
                value={search}
                onChangeText={setSearch}
                placeholder="Search job no., site, customer, machine"
                placeholderTextColor={color.placeholder}
                accessibilityLabel="Search jobs"
                style={{ flex: 1, height: 48, fontFamily: font.medium, fontSize: 15, color: color.ink }}
                returnKeyType="search"
                autoCorrect={false}
              />
            </View>
            <Chips<Group>
              value={group}
              onChange={setGroup}
              options={[
                { value: "all", label: "All", count: allCount },
                { value: "action", label: "Needs action", count: c.action ?? 0 },
                { value: "assigned", label: "New", count: c.assigned ?? 0 },
                { value: "active", label: "Active", count: c.active ?? 0 },
                { value: "pending", label: "Pending", count: c.pending ?? 0 },
                { value: "approved", label: "Approved", count: c.approved ?? 0 },
                { value: "closed", label: "Declined/cancelled", count: c.closed ?? 0 },
              ]}
            />
            <Chips<Range>
              value={range}
              onChange={setRange}
              options={[
                { value: "all", label: "All dates" },
                { value: "month", label: "This month" },
                { value: "week", label: "Last 7 days" },
              ]}
            />
            {error && items.length > 0 && <Banner tone="warning" title="Couldn't refresh" body={error.message} />}
            {meta && !loading && <Text style={[type.labelMd, { color: color.muted }]}>{meta.total} job{meta.total === 1 ? "" : "s"}</Text>}
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator style={{ marginTop: space.xl }} color={color.navy} />
          ) : error ? (
            <ErrorView error={error} onRetry={() => setFocusTick((n) => n + 1)} />
          ) : (
            <EmptyView icon="inbox" title="No jobs here" body={query ? `Nothing matches “${query}”.` : "Jobs matching this filter will appear here."} />
          )
        }
        ListFooterComponent={hasMore && !loading ? <Btn variant="outline" label="Load more" loading={busy === "more"} onPress={() => loadMore("more")} /> : undefined}
      />
    </View>
  );
}

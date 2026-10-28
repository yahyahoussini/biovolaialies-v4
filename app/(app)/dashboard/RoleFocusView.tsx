import Link from "next/link";
import { StatCard } from "@/components/domain/StatCard";
import { Badge } from "@/components/ui/Badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import type { FocusItem, RoleFocus } from "@/services/dashboard/role-focus";

/**
 * The first screen of each role (document 3, ch. 07): one question, the few figures that answer it,
 * and the work waiting for this person. The operational sections follow below for those who need them.
 */
export function RoleFocusView({ focus }: { focus: RoleFocus }) {
  return (
    <section aria-labelledby="role-focus-title" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id="role-focus-title" className="text-overline">
          {focus.title}
        </h2>
        <p className="text-lg font-semibold tracking-tight text-text">{focus.question}</p>
      </div>
      <div className={`grid grid-cols-2 gap-3 ${focus.tiles.length > 4 ? "lg:grid-cols-3 xl:grid-cols-6" : "lg:grid-cols-4"}`}>
        {focus.tiles.map((t) => {
          const card = <StatCard key={t.label} label={t.label} value={t.value} hint={t.hint} tone={t.tone ?? "default"} className="h-full" />;
          return t.href ? (
            <Link key={t.label} href={t.href} className="focus-ring rounded-xl">
              {card}
            </Link>
          ) : (
            card
          );
        })}
      </div>
      <div className={`grid grid-cols-1 gap-4 ${focus.lists.length > 1 ? "xl:grid-cols-2" : ""}`}>
        {focus.lists.map((list) => (
          <Card key={list.title}>
            <CardHeader>
              <CardTitle>{list.title}</CardTitle>
            </CardHeader>
            <CardContent>
              {list.items.length === 0 ? <p className="text-sm text-secondary">{list.empty}</p> : null}
              <ul className="flex flex-col divide-y divide-border">
                {list.items.slice(0, 10).map((item, i) => (
                  <li key={`${item.label}-${i}`}>
                    <Item item={item} />
                  </li>
                ))}
              </ul>
              {list.items.length > 10 ? <p className="pt-2 text-caption text-secondary">… et {list.items.length - 10} de plus.</p> : null}
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}

function Item({ item }: { item: FocusItem }) {
  const body = (
    <div className="flex items-start justify-between gap-3 py-2.5">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-sm font-semibold text-text">{item.label}</span>
        {item.detail ? <span className="text-caption text-secondary">{item.detail}</span> : null}
      </div>
      {item.badge ? <Badge tone={item.tone}>{item.badge}</Badge> : null}
    </div>
  );
  return item.href ? (
    <Link href={item.href} className="focus-ring block rounded-md transition-colors hover:bg-background">
      {body}
    </Link>
  ) : (
    body
  );
}

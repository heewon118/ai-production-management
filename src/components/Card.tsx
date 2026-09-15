/** 화면에서 반복해서 쓰는 카드 박스 */

type Props = {
  title: string;
  description?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
};

export default function Card({ title, description, action, children }: Props) {
  return (
    <section className="rounded-xl border border-line bg-card p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-ink">{title}</h2>
          {description ? <p className="mt-1 text-sm text-ink-muted">{description}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

/** Navigation search (spec §10.7): a plain GET form, so it works before hydration and on any phone. */
export function SearchBox({ defaultValue = "", className = "" }: { defaultValue?: string; className?: string }) {
  return (
    <form role="search" action="/search" method="get" className={className}>
      <input
        type="search"
        name="q"
        aria-label="Search"
        placeholder="Search…"
        defaultValue={defaultValue}
        autoComplete="off"
        className="field w-full"
      />
    </form>
  );
}

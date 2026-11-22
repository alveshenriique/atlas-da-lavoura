// The municipality page's only script (a few hundred bytes of work, no framework): the crop
// choice and the Gráfico | Tabela tabs of Figura 1, the CSV of a table built from the table
// itself, and the "Copiar link" button. Without JavaScript the page still shows everything:
// each crop's chart with its data table behind a disclosure, the controls stay hidden.

function setUpSeriesFigure(figure: HTMLElement) {
  const select = figure.querySelector<HTMLSelectElement>("[data-series-select]");
  const tablist = figure.querySelector<HTMLElement>('[role="tablist"]');
  const tabs = [...figure.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
  const panels = [...figure.querySelectorAll<HTMLElement>("[data-series-panel]")];
  if (!select || !tablist || tabs.length !== 2) return;
  select.closest("label")?.removeAttribute("hidden");
  tablist.removeAttribute("hidden");
  figure.classList.add("series--js");

  const showSeries = () => {
    for (const panel of panels) panel.hidden = panel.dataset.seriesPanel !== select.value;
  };
  const showTable = (table: boolean) => {
    tabs.forEach((tab, k) => {
      const selected = (k === 1) === table;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    figure.classList.toggle("series--table", table);
    figure.querySelector('[role="tabpanel"]')?.setAttribute("aria-labelledby", tabs[table ? 1 : 0]?.id ?? "");
    for (const details of figure.querySelectorAll<HTMLDetailsElement>("[data-series-data]")) details.open = table;
  };
  select.addEventListener("change", showSeries);
  tabs.forEach((tab, k) => {
    tab.addEventListener("click", () => showTable(k === 1));
    tab.addEventListener("keydown", (event) => {
      const keys: Record<string, number> = { ArrowLeft: 0, ArrowRight: 1, Home: 0, End: 1 };
      const target = keys[event.key];
      if (target === undefined) return;
      event.preventDefault();
      showTable(target === 1);
      tabs[target]?.focus();
    });
  });
  showSeries();
  showTable(false);
}

function csvOf(table: HTMLTableElement): string {
  const quote = (text: string) => (/[;"\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text);
  return [...table.rows]
    .map((row) => [...row.cells].map((cell) => quote((cell.textContent ?? "").replace(/\s+/g, " ").trim())).join(";"))
    .join("\r\n");
}

function setUpCsv(button: HTMLButtonElement) {
  const table = document.getElementById(button.dataset.csv ?? "");
  if (!(table instanceof HTMLTableElement)) return;
  button.hidden = false;
  button.addEventListener("click", () => {
    // A byte order mark, so spreadsheets read the accents; ";" as in Brazilian spreadsheets.
    const blob = new Blob(["﻿", csvOf(table)], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${button.dataset.csvName ?? "tabela"}.csv`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  });
}

function setUpCopyLink(button: HTMLButtonElement) {
  if (!navigator.clipboard) return;
  button.hidden = false;
  const label = button.textContent ?? "";
  button.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      button.textContent = "Link copiado";
    } catch {
      button.textContent = "Não foi possível copiar";
    }
    setTimeout(() => (button.textContent = label), 2000);
  });
}

for (const figure of document.querySelectorAll<HTMLElement>("[data-series-figure]")) setUpSeriesFigure(figure);
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-csv]")) setUpCsv(button);
for (const button of document.querySelectorAll<HTMLButtonElement>("[data-copy-link]")) setUpCopyLink(button);

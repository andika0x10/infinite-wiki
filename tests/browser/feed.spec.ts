import { expect, test, type Page } from "@playwright/test";
import { entries as makeEntries } from "../fixtures";

const content = {
  explanation: [
    "Computer science mempelajari bagaimana informasi direpresentasikan dan diproses. Di pusatnya ada algoritma: urutan langkah yang mengubah suatu masukan menjadi hasil. Sebuah algoritma dapat dijelaskan tanpa bergantung pada komputer tertentu, sehingga gagasannya bisa diterapkan pada berbagai perangkat.",
    "Bayangkan mencari sebuah nama di buku telepon. Memeriksa setiap halaman akan berhasil, tetapi memanfaatkan urutan abjad bisa mengurangi pekerjaan. Perbedaan ini menunjukkan bagaimana pilihan algoritma memengaruhi sumber daya yang diperlukan untuk menyelesaikan masalah.",
    "Bidang ini juga mencakup cara bahasa pemrograman menyatakan instruksi dan bagaimana sistem operasi mengatur pelaksanaannya. Teori dan praktik saling melengkapi: model membantu memahami batas suatu pendekatan, sementara sistem nyata memperlihatkan biaya serta komprominya.",
  ],
  importance:
    "Memahami komputasi memberi kita cara untuk menilai ketepatan, efisiensi, dan batas sebuah sistem. Pengetahuan ini menjadi landasan untuk mempelajari algoritma, arsitektur komputer, jaringan, hingga kecerdasan buatan.",
};
async function mockFeed(page: Page, options: { slow?: boolean; long?: boolean; longTitle?: boolean; failArticle?: number; rateLimit?: boolean } = {}) {
  let calls = 0;
  let failed = false;
  const catalog = makeEntries(100).map((entry) => {
    if (options.longTitle && entry.sequence > 1) {
      entry.topic.title = `HyperdimensionalComputerArchitectureAndRepresentation${entry.sequence}`;
      entry.topic.path[entry.topic.path.length - 1] = entry.topic.title;
    }
    return {
      ...entry,
      content: {
        ...content,
        explanation: options.long
          ? Array.from({ length: 4 }, () => content.explanation.join(" ").repeat(2))
          : [entry.topic.title + ". " + content.explanation[0], ...content.explanation.slice(1)],
      },
    };
  });
  let available = options.failArticle ? 1 : catalog.length;
  const requests: string[] = [];
  await page.route("**/api/feed**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/extend")) {
      requests.push("extend");
      calls++;
      if (options.failArticle && !failed) {
        failed = true;
        await route.fulfill({
          status: options.rateLimit ? 429 : 502,
          json: {
            error: {
              code: options.rateLimit ? "RATE_LIMITED" : "UPSTREAM_ERROR",
              message: "Layanan bacaan sedang tidak tersedia. Coba lagi.",
              retryAfter: options.rateLimit ? 2 : undefined,
            },
          },
        });
        return;
      }
      available++;
      await route.fulfill({ json: { status: "cached" } });
      return;
    }
    requests.push("feed");
    if (options.slow && calls === 0) await new Promise((resolve) => setTimeout(resolve, 1200));
    const after = Number(url.searchParams.get("after"));
    const limit = Number(url.searchParams.get("limit"));
    const selected = catalog.slice(after, Math.min(available, after + limit));
    calls += selected.length;
    await route.fulfill({
      json: { entries: selected, nextCursor: selected.at(-1)?.sequence ?? after, hasMore: available > after + selected.length, generation: { state: "idle" } },
    });
  });
  return { requests, calls: () => calls };
}
async function advance(page: Page, index: number) {
  const article = page.locator("article.feed-slide[data-ready=true]").nth(index);
  await expect(article).toBeAttached();
  await article.getByRole("button", { name: "Artikel berikutnya" }).click();
  await expect(page.locator(".reading-index")).toHaveText(String(index + 2).padStart(2, "0"));
}

test("feed reads the shared cache, one article ahead, IBM fonts and black/white design", async ({ page }, info) => {
  const mock = await mockFeed(page);
  await page.goto("/");
  await expect(page.locator("article.feed-slide[data-ready=true]")).toHaveCount(2);
  expect(mock.requests).toEqual(["feed"]);
  expect(await page.locator("body").evaluate((element) => getComputedStyle(element).backgroundColor)).toBe("rgb(255, 255, 255)");
  expect(
    await page
      .locator("h1")
      .first()
      .evaluate((element) => getComputedStyle(element).fontFamily)
  ).toContain("IBM Plex Sans");
  expect(
    await page
      .locator(".article-prose")
      .first()
      .evaluate((element) => getComputedStyle(element).fontFamily)
  ).toContain("IBM Plex Serif");
  await page.screenshot({ path: `test-results/feed-${info.project.name}.png` });
  await advance(page, 0);
  await expect(page.locator("article.feed-slide[data-ready=true]")).toHaveCount(3);
  const calls = mock.calls();
  await page.locator("article.feed-slide[data-ready=true]").nth(1).getByRole("button", { name: "Artikel sebelumnya" }).click();
  await expect(page.locator(".reading-index")).toHaveText("01");
  expect(mock.calls()).toBe(calls);
});

test("continues beyond 32 topics and reveals full ancestry", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockFeed(page);
  await page.goto("/");
  for (let i = 0; i < 34; i++) await advance(page, i);
  await expect(page.locator("article.feed-slide[data-ready=true]")).toHaveCount(36);
  const article = page.locator("article.feed-slide[data-ready=true]").nth(34);
  await article.getByText("Lihat jalur", { exact: true }).click();
  await expect(article.locator(".full-path[open]")).toBeVisible();
  expect(await article.locator(".full-path li").count()).toBeGreaterThan(3);
  expect(await page.locator("h1").allTextContents()).toHaveLength(36);
});

test("navigation animates inside the feed and reduced motion stays instant", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await mockFeed(page);
  await page.goto("/");
  await expect(page.locator("article.feed-slide[data-ready=true]")).toHaveCount(2);
  const next = page.locator("article.feed-slide").first().getByRole("button", { name: "Artikel berikutnya" });
  await next.scrollIntoViewIfNeeded();
  const movement = await next.evaluate(async (button) => {
    const feed = document.querySelector<HTMLElement>(".feed")!;
    const target = document.querySelector<HTMLElement>('[data-index="1"]')!;
    const destination = feed.scrollTop + target.getBoundingClientRect().top - feed.getBoundingClientRect().top;
    const start = feed.scrollTop;
    (button as HTMLButtonElement).click();
    const positions: number[] = [];
    for (let i = 0; i < 10; i++) {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      positions.push(feed.scrollTop);
    }
    return { start, destination, positions };
  });
  expect(movement.positions.some((position) => position > movement.start + 1 && position < movement.destination - 1)).toBe(true);
  await expect(page.locator(".reading-index")).toHaveText("02");
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await page
      .locator(".slide-inner")
      .first()
      .evaluate((el) => getComputedStyle(el).animationName)
  ).toBe("none");
  const previous = page.locator("article.feed-slide").nth(1).getByRole("button", { name: "Artikel sebelumnya" });
  await previous.evaluate((button) => (button as HTMLButtonElement).click());
  await expect(page.locator(".reading-index")).toHaveText("01");
  expect(await page.locator(".feed").evaluate((el) => el.scrollTop)).toBe(0);
});

test("native wheel scrolling keeps the reader inside a long article", async ({ page }) => {
  await mockFeed(page, { long: true });
  await page.goto("/");
  await expect(page.locator("article.feed-slide[data-ready=true]")).toHaveCount(2);
  const feed = page.locator(".feed");
  await feed.hover();
  await page.mouse.wheel(0, 180);
  await expect.poll(() => feed.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
  const position = await feed.evaluate((el) => el.scrollTop);
  expect(position).toBeLessThan(
    await page
      .locator("article.feed-slide")
      .first()
      .evaluate((el) => el.clientHeight)
  );
  await expect(page.locator(".reading-index")).toHaveText("01");
  await expect(page.locator("article.feed-slide[data-ready=true]")).toHaveCount(2);
});

test("loading and manual rate-limit retry preserve readable articles", async ({ page }, info) => {
  const mock = await mockFeed(page, { slow: true, failArticle: 2, rateLimit: true });
  await page.goto("/");
  await expect(page.getByRole("status")).toContainText("Menyiapkan bacaan pertama");
  await page.screenshot({ path: `test-results/loading-${info.project.name}.png` });
  await expect(page.getByRole("alert")).toBeAttached();
  await advance(page, 0);
  await expect(page.getByRole("button", { name: /Coba lagi dalam/ })).toBeDisabled();
  await page.screenshot({ path: `test-results/error-${info.project.name}.png` });
  await expect(page.getByRole("button", { name: "Coba lagi", exact: true })).toBeEnabled({ timeout: 6000 });
  expect(mock.calls()).toBe(2);
  await page.getByRole("button", { name: "Coba lagi", exact: true }).click();
  await expect(page.locator("article.feed-slide[data-ready=true]")).toHaveCount(3);
  await expect(page.locator("article.feed-slide[data-ready=true]").first()).toContainText("Computer science");
});

test("long articles remain fully scrollable before next slide; keyboard controls work", async ({ page }, info) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await mockFeed(page, { long: true });
  await page.goto("/");
  await expect(page.locator("article.feed-slide[data-ready=true]")).toHaveCount(2);
  const feed = page.locator(".feed");
  const first = page.locator("article.feed-slide[data-ready=true]").first();
  expect(await first.evaluate((el) => el.clientHeight)).toBeGreaterThan(await feed.evaluate((el) => el.clientHeight));
  await feed.evaluate((el) => {
    el.scrollTop = 250;
  });
  await expect(page.locator(".reading-index")).toHaveText("01");
  await first.getByRole("heading", { name: "Mengapa ini penting" }).scrollIntoViewIfNeeded();
  await expect(first.getByRole("heading", { name: "Mengapa ini penting" })).toBeInViewport();
  await page.screenshot({ path: `test-results/long-${info.project.name}.png` });
  const button = first.getByRole("button", { name: "Artikel berikutnya" });
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(page.locator(".reading-index")).toHaveText("02");
});

test("mobile 320px, long title, 404 and legacy redirect", async ({ page }, info) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await mockFeed(page, { longTitle: true });
  await page.goto("/artikel/system-call");
  await expect(page).toHaveURL(/\/$/);
  await advance(page, 0);
  await expect(page.locator("article.feed-slide[data-ready=true]").nth(1).getByRole("heading", { level: 1 })).toContainText("Hyperdimensional");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.locator(".feed").evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await page.screenshot({ path: `test-results/narrow-${info.project.name}.png` });
  await page.goto("/missing-page");
  await expect(page.getByRole("heading", { name: "Halaman tidak ditemukan." })).toBeVisible();
  await page.screenshot({ path: `test-results/not-found-${info.project.name}.png` });
  await page.getByRole("link", { name: "Kembali membaca" }).click();
  await expect(page.locator(".feed")).toBeVisible();
});

test("invalid cursors fail before accessing bindings and direct generation routes are removed", async ({ request }) => {
  for (const data of [{}, { after: -1 }, { after: "0" }, { after: 1.5 }, { topic: { title: "Physics" } }]) {
    const response = await request.post("/api/feed/extend", { data });
    expect(response.status()).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_CURSOR");
  }
  expect((await request.post("/api/feed/extend", { data: "{" })).status()).toBe(400);
  expect((await request.post("/api/feed/extend", { data: { payload: "x".repeat(25000) } })).status()).toBe(413);
  for (const query of ["after=-1", "after=NaN", "limit=0", "limit=21"]) expect((await request.get(`/api/feed?${query}`)).status()).toBe(400);
  for (const endpoint of ["articles", "branches"]) expect((await request.post(`/api/${endpoint}`, { data: {} })).status()).toBe(404);
});

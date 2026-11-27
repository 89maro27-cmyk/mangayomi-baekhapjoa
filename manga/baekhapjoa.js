const mangayomiSources = [
  {
    id: 123520101,
    name: "백합조아 (티스토리)",
    lang: "ko",
    baseUrl: "https://123zxcv52.tistory.com",
    version: "1.0.0",
    isNsfw: false
  }
];

const USER_AGENT =
  "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";

const EXCLUDED_TOP_CATEGORIES = new Set([
  "정발비공개",
  "정발미공개",
  "암호관련",
  "개인용",
  "번역예정"
]);

const EXCLUDED_KEYWORDS = ["정발비공개", "정발미공개"];

const SECTION_OPTIONS = [
  ["전체", ""],
  ["번역중", "번역중"],
  ["완결", "완결"],
  ["웹코믹", "웹코믹"],
  ["동인지", "동인지"],
  ["번역중단", "번역중단"]
];

const PAGE_SIZE = 10;
const CATALOG_TTL_MS = 5 * 60 * 1000;

const text = (el, selector) =>
  String((selector ? el?.selectFirst(selector) : el)?.text || "").trim();

const attr = (el, name) => String(el?.attr(name) || "").trim();

function decodeEntities(str) {
  return String(str || "").replace(
    /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp|middot|dagger);/gi,
    (match, entity) => {
      const lower = entity.toLowerCase();
      if (lower[0] === "#") {
        const isHex = lower[1] === "x";
        const code = parseInt(isHex ? lower.slice(2) : lower.slice(1), isHex ? 16 : 10);
        if (code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff)) {
          return String.fromCodePoint(code);
        }
        return match;
      }
      return (
        {
          amp: "&",
          lt: "<",
          gt: ">",
          quot: '"',
          apos: "'",
          nbsp: " ",
          middot: "·",
          dagger: "†"
        }[lower] || match
      );
    }
  );
}

function decodePathSegment(seg) {
  try {
    return decodeURIComponent(String(seg || ""));
  } catch (_) {
    return String(seg || "");
  }
}

function normalizePath(rawUrl, baseUrl) {
  let s = decodeEntities(String(rawUrl || "")).trim();
  if (!s) return "";
  if (baseUrl && s.toLowerCase().startsWith(baseUrl.toLowerCase())) {
    s = s.slice(baseUrl.length);
  }
  s = s.replace(/^https?:\/\/[^/]+/i, "");
  return s.split("#")[0];
}

function parseCategoryPath(href, baseUrl = "") {
  const cleaned = normalizePath(href, baseUrl).split("?")[0];
  if (!cleaned.startsWith("/category/")) return null;
  const rawParts = cleaned
    .slice("/category/".length)
    .split("/")
    .filter(Boolean);
  if (!rawParts.length) return null;

  const parent = decodePathSegment(rawParts[0]).trim();
  const series = rawParts.length > 1 ? decodePathSegment(rawParts.slice(1).join("/")).trim() : "";
  const encodedPath =
    "/category/" + rawParts.map((part) => encodeURIComponent(decodePathSegment(part))).join("/");

  return {
    path: encodedPath,
    parent,
    series,
    name: series || parent
  };
}

function isExcludedCategory(parent, fullPathOrName = "") {
  const p = String(parent || "").trim();
  const full = String(fullPathOrName || "").trim();
  if (EXCLUDED_TOP_CATEGORIES.has(p)) return true;
  return EXCLUDED_KEYWORDS.some((kw) => p.includes(kw) || full.includes(kw));
}

function statusFromCategory(parent, name) {
  const p = String(parent || "");
  const n = String(name || "");
  if (p === "완결" || p === "동인지" || n.includes("(완결)")) return 1;
  if (p === "번역중" || p === "웹코믹") return 0;
  if (p === "번역중단") return 3;
  return 5;
}

function parseDateUpload(dateText) {
  const m = /(\d{4})\.(\d{2})\.(\d{2})/.exec(String(dateText || "").trim());
  if (!m) return null;
  const ts = Date.parse(`${m[1]}-${m[2]}-${m[3]}T00:00:00+09:00`);
  return Number.isFinite(ts) ? String(ts) : null;
}

function normalizeImageUrl(url, baseUrl) {
  let u = decodeEntities(String(url || "")).trim();
  if (!u) return "";
  if (u.startsWith("//")) u = "https:" + u;
  else if (u.startsWith("/")) u = baseUrl + u;
  if (!/^https?:\/\/[^\s\\]+$/i.test(u)) return "";
  if (/no-image-v1\.png|tistory_admin\/static/i.test(u)) return "";
  return u;
}

class DefaultExtension extends MProvider {
  get supportsLatest() {
    return true;
  }

  get baseUrl() {
    const raw =
      String(new SharedPreferences().get("base_url") || this.source.baseUrl)
        .trim()
        .replace(/\/+$/, "") || this.source.baseUrl;
    if (!/^https?:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::[0-9]{1,5})?$/i.test(raw)) {
      throw new Error("http:// 또는 https://로 시작하는 사이트 주소를 입력해 주세요.");
    }
    const port = /:(\d+)$/.exec(raw)?.[1];
    if (port && (Number(port) < 1 || Number(port) > 65535)) {
      throw new Error("올바른 포트 번호를 입력해 주세요.");
    }
    return raw;
  }

  get client() {
    return (this._client ||= new Client({ timeout: 15, connectTimeout: 5 }));
  }

  get thumbCache() {
    return (this._thumbCache ||= new Map());
  }

  getHeaders(url) {
    return {
      "User-Agent": USER_AGENT,
      Referer: (url || this.baseUrl).replace(/\/+$/, "") + "/"
    };
  }

  getSourcePreferences() {
    return [
      {
        key: "list_thumbnails",
        switchPreferenceCompat: {
          title: "목록 표지",
          summary: "꺼두면 목록 표지를 생략해 이미지 요청을 줄입니다. 작품 상세 표지는 유지됩니다.",
          value: true
        }
      },
      {
        key: "base_url",
        editTextPreference: {
          title: "사이트 주소",
          summary: "전체 사이트 주소를 입력합니다. 비우면 기본 주소로 돌아갑니다.",
          value: this.source.baseUrl,
          dialogTitle: "사이트 주소",
          dialogMessage: "예: https://123zxcv52.tistory.com"
        }
      }
    ];
  }

  async html(path) {
    const targetUrl = path.startsWith("http") ? path : this.baseUrl + path;
    for (let attempt = 0; attempt < 2; attempt++) {
      let res;
      try {
        res = await this.client.get(targetUrl, this.getHeaders());
      } catch (err) {
        if (attempt === 1) throw err;
      }
      if (res) {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          return String(res.body || "");
        }
        if (attempt === 1 || ![408, 500, 502, 503, 504].includes(res.statusCode)) {
          throw new Error(`사이트 요청에 실패했습니다 (HTTP ${res.statusCode}).`);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    throw new Error("사이트 응답을 받지 못했습니다.");
  }

  async document(path) {
    const body = await this.html(path);
    return new Document(body.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")).body;
  }

  parseArticles(doc) {
    const base = this.baseUrl;
    const items = [];
    for (const article of doc.select("article.article-type-common")) {
      const linkEl = article.selectFirst("a.link-article");
      const rawHref = attr(linkEl, "href");
      const postMatch = /\/(\d+)(?:[?#]|$)/.exec(rawHref);
      if (!postMatch) continue;
      const postUrl = `/${postMatch[1]}`;

      const rawTitle =
        text(article, "strong.title") || attr(linkEl, "data-tiara-name") || attr(linkEl, "data-tiara-copy");
      const title = decodeEntities(rawTitle).replace(/\s+/g, " ").trim();
      if (!title) continue;

      const dateUpload = parseDateUpload(text(article, "span.date"));
      const catEl = article.selectFirst("a.link-category");
      const categoryHref = attr(catEl, "href");
      const categoryText = decodeEntities(text(catEl)).replace(/\s+/g, " ").trim();

      const thumbEl = article.selectFirst("img.img-thumbnail");
      const rawThumb = attr(thumbEl, "src") || attr(linkEl, "data-tiara-image");
      const thumbnail = normalizeImageUrl(rawThumb, base);

      items.push({
        postUrl,
        title,
        dateUpload,
        categoryHref,
        categoryText,
        thumbnail
      });
    }
    return items;
  }

  lastPage(doc) {
    let maxPage = 1;
    for (const a of doc.select(".area-paging .paging_num a[href]")) {
      const href = attr(a, "href");
      const m = /[?&]page=(\d+)(?:&|$)/.exec(href);
      if (m) {
        const n = Number(m[1]);
        if (Number.isFinite(n) && n > maxPage) maxPage = n;
      }
    }
    return maxPage;
  }

  async loadCatalog() {
    const now = Date.now();
    if (this._catalogCache && now - this._catalogCache.time < CATALOG_TTL_MS) {
      return this._catalogCache.items;
    }

    const doc = await this.document("/");
    const base = this.baseUrl;
    const seen = new Set();
    const items = [];

    for (const li of doc.select("ul.tt_category ul.category_list > li")) {
      const topLink = li.selectFirst("a.link_item");
      const topCat = parseCategoryPath(attr(topLink, "href"), base);
      if (!topCat || isExcludedCategory(topCat.parent, topCat.path)) continue;

      const subLinks = li.select("ul.sub_category_list a.link_sub_item");
      if (subLinks.length > 0) {
        for (const sub of subLinks) {
          const subCat = parseCategoryPath(attr(sub, "href"), base);
          if (!subCat || isExcludedCategory(subCat.parent, `${subCat.path} ${subCat.name}`)) continue;
          if (seen.has(subCat.path)) continue;
          seen.add(subCat.path);
          items.push({
            name: subCat.name,
            link: subCat.path,
            parent: subCat.parent,
            status: statusFromCategory(subCat.parent, subCat.name)
          });
        }
      } else if (!seen.has(topCat.path)) {
        seen.add(topCat.path);
        items.push({
          name: topCat.name,
          link: topCat.path,
          parent: topCat.parent,
          status: statusFromCategory(topCat.parent, topCat.name)
        });
      }
    }

    for (const art of this.parseArticles(doc)) {
      const cat = parseCategoryPath(art.categoryHref, base);
      if (!cat || isExcludedCategory(cat.parent, `${cat.path} ${art.categoryText}`)) continue;
      if (art.thumbnail && !this.thumbCache.has(cat.path)) {
        this.thumbCache.set(cat.path, art.thumbnail);
      }
    }

    this._catalogCache = { time: now, items };
    return items;
  }

  async attachThumbnails(items) {
    const showThumbs = new SharedPreferences().get("list_thumbnails") !== false;
    if (!showThumbs) {
      return items.map((item) => ({
        name: item.name,
        link: item.link,
        imageUrl: ""
      }));
    }

    const missing = items.filter((item) => !this.thumbCache.has(item.link));
    let cursor = 0;
    const workers = Math.min(3, missing.length);
    await Promise.all(
      Array.from({ length: workers }, async () => {
        while (cursor < missing.length) {
          const item = missing[cursor++];
          try {
            const doc = await this.document(item.link);
            const firstThumb = this.parseArticles(doc).find((a) => a.thumbnail)?.thumbnail || "";
            this.thumbCache.set(item.link, firstThumb);
          } catch (_) {
            this.thumbCache.set(item.link, "");
          }
        }
      })
    );

    return items.map((item) => ({
      name: item.name,
      link: item.link,
      imageUrl: this.thumbCache.get(item.link) || ""
    }));
  }

  async getPopular(page) {
    const catalog = await this.loadCatalog();
    const start = (page - 1) * PAGE_SIZE;
    const slice = catalog.slice(start, start + PAGE_SIZE);
    const list = await this.attachThumbnails(slice);
    return {
      list,
      hasNextPage: start + PAGE_SIZE < catalog.length
    };
  }

  async getLatestUpdates(page) {
    const doc = await this.document(`/?page=${page}`);
    const base = this.baseUrl;
    const showThumbs = new SharedPreferences().get("list_thumbnails") !== false;
    const seen = new Set();
    const list = [];

    for (const art of this.parseArticles(doc)) {
      const cat = parseCategoryPath(art.categoryHref, base);
      if (!cat || isExcludedCategory(cat.parent, `${cat.path} ${art.categoryText}`)) continue;
      if (art.thumbnail && !this.thumbCache.has(cat.path)) {
        this.thumbCache.set(cat.path, art.thumbnail);
      }
      if (seen.has(cat.path)) continue;
      seen.add(cat.path);
      list.push({
        name: cat.name,
        link: cat.path,
        imageUrl: showThumbs ? art.thumbnail || this.thumbCache.get(cat.path) || "" : ""
      });
    }

    return {
      list,
      hasNextPage: this.lastPage(doc) > page
    };
  }

  getFilterList() {
    return [
      {
        type_name: "SelectFilter",
        type: "section",
        name: "분류",
        state: 0,
        values: SECTION_OPTIONS.map(([name, value]) => ({
          type_name: "SelectOption",
          name,
          value
        }))
      }
    ];
  }

  async search(query, page, filters = []) {
    const q = String(query || "").trim();
    const sectionFilter = (filters || []).find((f) => f.type === "section");
    const section = sectionFilter?.values?.[sectionFilter.state]?.value || "";

    if (!q) {
      const catalog = await this.loadCatalog();
      const filtered = section ? catalog.filter((item) => item.parent === section) : catalog;
      const start = (page - 1) * PAGE_SIZE;
      const slice = filtered.slice(start, start + PAGE_SIZE);
      const list = await this.attachThumbnails(slice);
      return {
        list,
        hasNextPage: start + PAGE_SIZE < filtered.length
      };
    }

    const base = this.baseUrl;
    const showThumbs = new SharedPreferences().get("list_thumbnails") !== false;
    const seen = new Set();
    const results = [];

    if (page === 1) {
      const catalog = await this.loadCatalog();
      const qLower = q.toLowerCase();
      const matchedCatalog = catalog.filter(
        (item) => (!section || item.parent === section) && item.name.toLowerCase().includes(qLower)
      );
      const withThumbs = await this.attachThumbnails(matchedCatalog);
      for (const item of withThumbs) {
        if (!seen.has(item.link)) {
          seen.add(item.link);
          results.push(item);
        }
      }
    }

    const searchDoc = await this.document(`/search/${encodeURIComponent(q)}?page=${page}`);
    for (const art of this.parseArticles(searchDoc)) {
      const cat = parseCategoryPath(art.categoryHref, base);
      if (!cat || isExcludedCategory(cat.parent, `${cat.path} ${art.categoryText}`)) continue;
      if (section && cat.parent !== section) continue;
      if (art.thumbnail && !this.thumbCache.has(cat.path)) {
        this.thumbCache.set(cat.path, art.thumbnail);
      }
      if (seen.has(cat.path)) continue;
      seen.add(cat.path);
      results.push({
        name: cat.name,
        link: cat.path,
        imageUrl: showThumbs ? art.thumbnail || this.thumbCache.get(cat.path) || "" : ""
      });
    }

    return {
      list: results,
      hasNextPage: this.lastPage(searchDoc) > page
    };
  }

  async getDetail(url) {
    const base = this.baseUrl;
    const path = normalizePath(url, base);

    if (path.startsWith("/category/")) {
      const cat = parseCategoryPath(path, base);
      if (!cat || isExcludedCategory(cat.parent, `${cat.path} ${cat.name}`)) {
        throw new Error("정발비공개 등 제외된 분류입니다.");
      }

      const firstDoc = await this.document(cat.path);
      const totalPages = Math.min(this.lastPage(firstDoc), 100);
      const allArticles = [...this.parseArticles(firstDoc)];

      for (let p = 2; p <= totalPages; p += 3) {
        const batch = await Promise.all(
          Array.from({ length: Math.min(3, totalPages - p + 1) }, async (_, idx) => {
            const doc = await this.document(`${cat.path}?page=${p + idx}`);
            return this.parseArticles(doc);
          })
        );
        for (const list of batch) {
          allArticles.push(...list);
        }
      }

      const seenChapters = new Set();
      const chapters = [];
      let coverUrl = this.thumbCache.get(cat.path) || "";

      for (const art of allArticles) {
        if (!coverUrl && art.thumbnail) {
          coverUrl = art.thumbnail;
        }
        if (seenChapters.has(art.postUrl)) continue;
        seenChapters.add(art.postUrl);
        chapters.push({
          name: art.title,
          url: art.postUrl,
          dateUpload: art.dateUpload
        });
      }

      if (coverUrl) {
        this.thumbCache.set(cat.path, coverUrl);
      }

      return {
        name: cat.name,
        link: cat.path,
        imageUrl: coverUrl,
        author: "백.합.조.아",
        description: `분류: ${cat.parent}${cat.series ? " / " + cat.series : ""} (총 ${chapters.length}화)`,
        genre: [cat.parent],
        status: statusFromCategory(cat.parent, cat.name),
        chapters
      };
    }

    const postMatch = /\/(\d+)(?:[?#]|$)/.exec(path);
    if (!postMatch) {
      throw new Error("올바른 작품 또는 게시글 주소가 아닙니다.");
    }
    const postPath = `/${postMatch[1]}`;
    const doc = await this.document(postPath);

    const catEl = doc.selectFirst("a.link-category, .category a[href*='/category/']");
    const cat = parseCategoryPath(attr(catEl, "href"), base);
    if (cat && isExcludedCategory(cat.parent, `${cat.path} ${cat.name}`)) {
      throw new Error("정발비공개 등 제외된 분류입니다.");
    }

    const rawTitle =
      attr(doc.selectFirst('meta[property="og:title"]'), "content") ||
      text(doc, "h2.title, h1.title, .title-article");
    const title = decodeEntities(rawTitle).replace(/\s+/g, " ").trim() || `게시글 ${postMatch[1]}`;
    const coverUrl = normalizeImageUrl(
      attr(doc.selectFirst('meta[property="og:image"]'), "content"),
      base
    );
    const dateUpload = parseDateUpload(text(doc, ".date, span.date"));

    return {
      name: title,
      link: postPath,
      imageUrl: coverUrl,
      author: "백.합.조.아",
      description: cat ? `분류: ${cat.parent}${cat.series ? " / " + cat.series : ""}` : "",
      genre: cat ? [cat.parent] : [],
      status: cat ? statusFromCategory(cat.parent, cat.name) : 5,
      chapters: [
        {
          name: title,
          url: postPath,
          dateUpload
        }
      ]
    };
  }

  async getPageList(url) {
    const base = this.baseUrl;
    const path = normalizePath(url, base);
    const postMatch = /\/(\d+)(?:[?#]|$)/.exec(path);
    if (!postMatch) {
      throw new Error("올바른 게시글 주소가 아닙니다.");
    }

    const postPath = `/${postMatch[1]}`;
    const rawHtml = await this.html(postPath);
    if (
      /name=["']password["']|class=["'][^"']*protected_form|보호되어 있는 글입니다/i.test(rawHtml)
    ) {
      throw new Error("비밀번호로 보호된 글입니다.");
    }

    const doc = new Document(
      rawHtml.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    ).body;

    const container =
      doc.selectFirst(".contents_style") ||
      doc.selectFirst(".entry-content") ||
      doc.selectFirst("article") ||
      doc;

    const urls = [];
    const seen = new Set();

    const addUrl = (raw) => {
      const normalized = normalizeImageUrl(raw, base);
      if (normalized && !seen.has(normalized)) {
        seen.add(normalized);
        urls.push(normalized);
      }
    };

    for (const figure of container.select("figure.imageblock")) {
      const span = figure.selectFirst("span[data-url], span[data-phocus]");
      const img = figure.selectFirst("img");
      const candidate =
        attr(span, "data-url") ||
        attr(span, "data-phocus") ||
        attr(img, "data-url") ||
        attr(img, "src");
      addUrl(candidate);
    }

    if (!urls.length) {
      for (const img of container.select("img")) {
        if (attr(img, "class").includes("img-profile")) continue;
        addUrl(attr(img, "data-url") || attr(img, "src"));
      }
    }

    if (!urls.length) {
      throw new Error("게시글에서 이미지를 찾을 수 없습니다.");
    }

    return urls.map((imgUrl) => ({
      url: imgUrl,
      headers: this.getHeaders()
    }));
  }
  }

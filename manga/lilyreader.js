const mangayomiSources = [
  {
    id: 123520201,
    name: "LilyReader 만화",
    lang: "ko",
    baseUrl: "https://www.lilyreader.online",
    version: "1.0.0",
    isNsfw: false,
    itemType: 0,
    isManga: true,
    additionalParams: '{"mode":"manga"}'
  },
  {
    id: 123520202,
    name: "LilyReader 소설",
    lang: "ko",
    baseUrl: "https://www.lilyreader.online",
    version: "1.0.0",
    isNsfw: false,
    itemType: 2,
    isManga: false,
    additionalParams: '{"mode":"novel"}'
  }
];

const FIRESTORE_SERIES_URL =
  "https://firestore.googleapis.com/v1/projects/dcreader-project/databases/(default)/documents/series";
const DC_BASE = "https://m.dcinside.com";
const CORS_PROXY = "https://corsproxy.lilyd3v.workers.dev/";
const USER_AGENT =
  "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";

const PAGE_SIZE = 20;
const CATALOG_TTL_MS = 5 * 60 * 1000;

const TAG_FILTER_OPTIONS = [
  ["전체", ""],
  ["웹툰", "웹툰"],
  ["연재중", "연재중"],
  ["완결", "완결"],
  ["모음집", "모음집"]
];

const SORT_OPTIONS = [
  ["최근 업데이트순", "latest"],
  ["가나다순", "abc"],
  ["회차 많은순", "episodes"]
];

const attr = (el, name) => String(el?.attr(name) || "").trim();

function parseParams(source) {
  const matched = mangayomiSources.find((s) => s.id === source?.id) || source;
  try {
    return JSON.parse(matched?.additionalParams || "{}");
  } catch (_) {
    return {};
  }
}

function escapeHtml(str) {
  return String(str || "").replace(/[&<>"]/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;"
  }[ch]));
}

function decodeEntities(str) {
  return String(str || "").replace(
    /&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp|middot);/gi,
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
          middot: "·"
        }[lower] || match
      );
    }
  );
}

function normalizeCoverUrl(url) {
  let u = decodeEntities(String(url || "")).trim();
  if (!u) return "";
  if (u.startsWith("./")) {
    u = "https://www.lilyreader.online/" + u.slice(2);
  } else if (u.startsWith("/")) {
    u = "https://www.lilyreader.online" + u;
  } else if (u.startsWith("//")) {
    u = "https:" + u;
  }
  if (/^http:\/\/(?:dcimg|dccdn)[a-z0-9-]*\.dcinside\.(?:co\.kr|com)/i.test(u)) {
    u = u.replace(/^http:/i, "https:");
  }
  if (!/^https?:\/\/[^\s\\]+$/i.test(u)) return "";
  return u;
}

function normalizeDcImageUrl(url) {
  let u = decodeEntities(String(url || "")).trim();
  if (!u) return "";
  if (u.startsWith("//")) u = "https:" + u;
  if (/^http:\/\/(?:dcimg|dccdn)[a-z0-9-]*\.dcinside\.(?:co\.kr|com)/i.test(u)) {
    u = u.replace(/^http:/i, "https:");
  }
  if (!/^https?:\/\/[^\s\\]+$/i.test(u)) return "";
  if (/nstatic\.dcinside\.com|gallview_loading|dccon_loading|dccon\.php|image\.dcinside\.com\/dccon/i.test(u)) {
    return "";
  }
  return u;
}

function parseFirestoreDoc(doc) {
  const name = String(doc?.name || "");
  const id = name.split("/").filter(Boolean).pop() || "";
  const fields = doc?.fields || {};
  const title = String(fields.title?.stringValue || "").trim();
  const cover = normalizeCoverUrl(fields.cover?.stringValue || "");
  const tags = (fields.tags?.arrayValue?.values || [])
    .map((v) => String(v?.stringValue || "").trim())
    .filter(Boolean);

  const rawEpisodes = fields.episodes?.arrayValue?.values || [];
  const episodes = [];
  let maxEpTs = 0;

  for (const item of rawEpisodes) {
    const f = item?.mapValue?.fields;
    if (!f) continue;
    const epId = Number(f.id?.integerValue ?? f.id?.stringValue ?? 0);
    if (!Number.isFinite(epId) || epId <= 0) continue;
    const epTitle = String(f.title?.stringValue || "").trim() || `${epId}화`;
    const epTs = Date.parse(String(f.datetime?.timestampValue || f.datetime?.stringValue || ""));
    if (Number.isFinite(epTs) && epTs > maxEpTs) {
      maxEpTs = epTs;
    }
    episodes.push({
      id: epId,
      title: epTitle,
      dateUpload: Number.isFinite(epTs) ? String(epTs) : null
    });
  }

  const docUpdateTs = Date.parse(String(doc?.updateTime || ""));
  const updatedAt = maxEpTs || (Number.isFinite(docUpdateTs) ? docUpdateTs : 0);

  return {
    id,
    title,
    cover,
    tags,
    episodes,
    updatedAt
  };
}

function matchesTagFilter(tags, filterValue) {
  if (!filterValue) return true;
  if (filterValue === "완결") {
    return tags.some((t) => t === "완결(完)" || t === "완결" || t.includes("완결"));
  }
  return tags.includes(filterValue);
}

function statusFromTags(tags) {
  if (tags.some((t) => t.includes("완결"))) return 1;
  if (tags.includes("연재중")) return 0;
  return 5;
}

class DefaultExtension extends MProvider {
  get supportsLatest() {
    return true;
  }

  get isNovel() {
    return (
      this.source?.itemType === 2 ||
      this.source?.isManga === false ||
      parseParams(this.source).mode === "novel"
    );
  }

  get client() {
    return (this._client ||= new Client({ timeout: 20, connectTimeout: 5 }));
  }

  getHeaders(_url) {
    return {
      "User-Agent": USER_AGENT,
      Referer: "https://m.dcinside.com/"
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
      }
    ];
  }

  async loadAllSeries() {
    const now = Date.now();
    if (this._seriesCache && now - this._seriesCache.time < CATALOG_TTL_MS) {
      return this._seriesCache.items;
    }

    const items = [];
    let pageToken = "";
    for (let page = 0; page < 20; page++) {
      const queryUrl =
        `${FIRESTORE_SERIES_URL}?pageSize=300` +
        (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : "");
      const res = await this.client.get(queryUrl, {
        "User-Agent": USER_AGENT,
        Accept: "application/json"
      });
      if (res.statusCode < 200 || res.statusCode >= 300) {
        throw new Error(`LilyReader 목록을 불러오지 못했습니다 (HTTP ${res.statusCode}).`);
      }
      let data;
      try {
        data = JSON.parse(String(res.body || "{}"));
      } catch (_) {
        throw new Error("LilyReader 목록 응답을 파싱할 수 없습니다.");
      }
      for (const doc of data.documents || []) {
        const parsed = parseFirestoreDoc(doc);
        if (parsed.id && parsed.title) {
          items.push(parsed);
        }
      }
      if (!data.nextPageToken) break;
      pageToken = String(data.nextPageToken);
    }

    this._seriesCache = { time: now, items };
    return items;
  }

  async loadModeSeries() {
    const all = await this.loadAllSeries();
    if (this.isNovel) {
      return all.filter((s) => s.tags.includes("소설"));
    }
    return all.filter((s) => !s.tags.includes("소설"));
  }

  paginate(items, page) {
    const showThumbs = new SharedPreferences().get("list_thumbnails") !== false;
    const start = (page - 1) * PAGE_SIZE;
    const slice = items.slice(start, start + PAGE_SIZE);
    return {
      list: slice.map((s) => ({
        name: s.title,
        link: `/series/${s.id}`,
        imageUrl: showThumbs ? s.cover : ""
      })),
      hasNextPage: start + PAGE_SIZE < items.length
    };
  }

  async getPopular(page) {
    const items = [...(await this.loadModeSeries())].sort(
      (a, b) => b.episodes.length - a.episodes.length || b.updatedAt - a.updatedAt
    );
    return this.paginate(items, page);
  }

  async getLatestUpdates(page) {
    const items = [...(await this.loadModeSeries())].sort((a, b) => b.updatedAt - a.updatedAt);
    return this.paginate(items, page);
  }

  getFilterList() {
    const makeSelect = (type, name, options) => ({
      type_name: "SelectFilter",
      type,
      name,
      state: 0,
      values: options.map(([label, value]) => ({
        type_name: "SelectOption",
        name: label,
        value
      }))
    });
    return [
      makeSelect("tag", "분류", TAG_FILTER_OPTIONS),
      makeSelect("sort", "정렬", SORT_OPTIONS)
    ];
  }

  async search(query, page, filters = []) {
    const q = String(query || "").trim().toLowerCase();
    const getFilterVal = (type, fallback = "") => {
      const f = (filters || []).find((item) => item.type === type);
      return f?.values?.[f.state]?.value ?? fallback;
    };
    const tagFilter = getFilterVal("tag", "");
    const sortFilter = getFilterVal("sort", "latest");

    let items = (await this.loadModeSeries()).filter((s) => {
      if (!matchesTagFilter(s.tags, tagFilter)) return false;
      if (!q) return true;
      return (
        s.title.toLowerCase().includes(q) ||
        s.tags.some((t) => t.toLowerCase().includes(q))
      );
    });

    items = [...items];
    if (sortFilter === "abc") {
      items.sort((a, b) => a.title.localeCompare(b.title, "ko"));
    } else if (sortFilter === "episodes") {
      items.sort((a, b) => b.episodes.length - a.episodes.length || b.updatedAt - a.updatedAt);
    } else {
      items.sort((a, b) => b.updatedAt - a.updatedAt);
    }

    return this.paginate(items, page);
  }

  async getDetail(url) {
    const m = /\/series\/([^/?#]+)/.exec(String(url || ""));
    if (!m) {
      throw new Error("올바른 LilyReader 작품 주소가 아닙니다.");
    }
    const docId = decodeURIComponent(m[1]);
    let series = (await this.loadAllSeries()).find((s) => s.id === docId);

    if (!series) {
      const res = await this.client.get(
        `${FIRESTORE_SERIES_URL}/${encodeURIComponent(docId)}`,
        { "User-Agent": USER_AGENT, Accept: "application/json" }
      );
      if (res.statusCode < 200 || res.statusCode >= 300) {
        throw new Error(`작품 정보를 찾을 수 없습니다 (HTTP ${res.statusCode}).`);
      }
      series = parseFirestoreDoc(JSON.parse(String(res.body || "{}")));
    }

    const chapters = [...series.episodes].reverse().map((ep) => ({
      name: ep.title,
      url: `/board/lilyfever/${ep.id}`,
      dateUpload: ep.dateUpload
    }));

    return {
      name: series.title,
      link: `/series/${series.id}`,
      imageUrl: series.cover,
      author: "LilyReader (대세는 백합 갤러리)",
      description: `태그: ${series.tags.join(", ") || "없음"} (총 ${chapters.length}화)`,
      genre: series.tags,
      status: statusFromTags(series.tags),
      chapters
    };
  }

  async fetchDcPostHtml(postId) {
    const targetUrl = `${DC_BASE}/board/lilyfever/${postId}`;
    try {
      const direct = await this.client.get(targetUrl, this.getHeaders());
      const body = String(direct.body || "");
      if (
        direct.statusCode >= 200 &&
        direct.statusCode < 300 &&
        /class=["'][^"']*(?:thum-txtin|write_div)/i.test(body)
      ) {
        return body;
      }
    } catch (_) {
      // Fallback to LilyReader CORS proxy below
    }

    const proxyRes = await this.client.post(
      CORS_PROXY,
      {
        "User-Agent": USER_AGENT,
        "Content-Type": "application/json",
        Origin: "https://www.lilyreader.online",
        Referer: "https://www.lilyreader.online/"
      },
      JSON.stringify({ url: targetUrl })
    );
    if (proxyRes.statusCode >= 200 && proxyRes.statusCode < 300) {
      const proxyBody = String(proxyRes.body || "");
      if (/class=["'][^"']*(?:thum-txtin|write_div)/i.test(proxyBody)) {
        return proxyBody;
      }
    }
    throw new Error(`게시글을 불러오지 못했습니다 (글번호: ${postId}).`);
  }

  extractPostId(url) {
    const m = /\/(?:board\/lilyfever\/)?(\d+)(?:[?#]|$)/.exec(String(url || "").trim());
    if (!m) {
      throw new Error("올바른 게시글 주소가 아닙니다.");
    }
    return m[1];
  }

  async getPageList(url) {
    const postId = this.extractPostId(url);
    const rawHtml = await this.fetchDcPostHtml(postId);
    const doc = new Document(
      rawHtml.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "")
    ).body;

    const container = doc.selectFirst(".thum-txtin") || doc.selectFirst(".write_div") || doc;
    const seen = new Set();
    const urls = [];

    for (const img of container.select("img")) {
      if (attr(img, "class").includes("written_dccon")) continue;
      const candidate = attr(img, "data-original") || attr(img, "src");
      const normalized = normalizeDcImageUrl(candidate);
      if (normalized && !seen.has(normalized)) {
        seen.add(normalized);
        urls.push(normalized);
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

  async getHtmlContent(name, url) {
    const postId = this.extractPostId(url);
    const rawHtml = await this.fetchDcPostHtml(postId);
    const stripped = rawHtml.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, "");
    const doc = new Document(stripped).body;
    const container = doc.selectFirst(".thum-txtin") || doc.selectFirst(".write_div");

    if (!container) {
      throw new Error("회차 본문을 찾을 수 없습니다.");
    }

    let html = String(container.innerHtml || container.outerHtml || "");
    html = html
      .replace(/<div[^>]*class=["'][^"']*adv-groupno[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, "")
      .replace(/<div[^>]*id=["']auto_picture_area["'][^>]*>[\s\S]*?<\/div>/gi, "")
      .replace(/<div[^>]*class=["'][^"']*dc_series[^"']*["'][^>]*>[\s\S]*?<\/div>/gi, "")
      .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, "")
      .replace(/<img[^>]*class=["'][^"']*written_dccon[^"']*["'][^>]*>/gi, "")
      .replace(/<img\b([^>]*?)data-original=(["'])([^"']+)\2([^>]*)>/gi, (_, pre, q, orig, post) => {
        const cleanOrig = normalizeDcImageUrl(orig);
        if (!cleanOrig) return "";
        const attrs = `${pre} ${post}`.replace(/\bsrc=(["'])[^"']*\1|\bsrc=[^\s>]+/gi, "");
        return `<img src="${cleanOrig}" ${attrs}>`;
      })
      .trim();

    if (!html) {
      throw new Error("회차 본문이 비어 있습니다.");
    }

    return `<h2>${escapeHtml(String(name || "").trim())}</h2>\n${html}`;
  }

  async cleanHtmlContent(html) {
    return html;
  }
}

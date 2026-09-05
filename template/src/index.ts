import type { Source } from "@aletheia-ios/sdk/types";
import { SourceError } from "@aletheia-ios/sdk/utils";
import catalogue from "../fixtures/catalogue.json" with { type: "json" };

/**
 * An offline source: everything it returns is baked in at build time, and `hosts` is `[]`
 * so the app refuses any network call.
 *
 * Replace this file with a real one; the mangadex package in aletheia-ios/sample shows the
 * shape of a source that talks to a site.
 */
const source: Source = {
  async search(query) {
    const text = (query.text ?? "").toLowerCase();
    const items = catalogue.series
      .filter((series) => text === "" || series.title.toLowerCase().includes(text))
      .map((series) => ({ slug: series.slug, title: series.title, cover: null, adult: false }));
    return { items, next: null };
  },

  async details(seriesSlug) {
    const series = catalogue.series.find((candidate) => candidate.slug === seriesSlug);
    if (series === undefined) throw new SourceError("notFound", seriesSlug);
    return {
      slug: series.slug,
      title: series.title,
      altTitles: [],
      synopsis: series.synopsis,
      url: `https://example.com/series/${series.slug}`,
      classification: "Safe",
      publication: "Ongoing",
      covers: [],
      tags: series.tags,
      authors: series.authors,
    };
  },

  async chapters(seriesSlug) {
    const series = catalogue.series.find((candidate) => candidate.slug === seriesSlug);
    if (series === undefined) throw new SourceError("notFound", seriesSlug);
    return series.chapters.map((chapter, index) => ({
      slug: chapter.slug,
      title: chapter.title,
      number: index + 1,
      language: "en" as const,
      scanlator: "__NAME__",
      url: `https://example.com/series/${series.slug}/${chapter.slug}`,
      publishedDate: null,
    }));
  },

  async content(seriesSlug, chapterSlug) {
    const series = catalogue.series.find((candidate) => candidate.slug === seriesSlug);
    const chapter = series?.chapters.find((candidate) => candidate.slug === chapterSlug);
    if (chapter === undefined) throw new SourceError("notFound", chapterSlug);
    return chapter.pages.map((url, index) => ({ index, url }));
  },
};

export default source;

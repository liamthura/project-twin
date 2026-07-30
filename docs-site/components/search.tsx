'use client';
import {
  SearchDialog,
  SearchDialogClose,
  SearchDialogContent,
  SearchDialogHeader,
  SearchDialogIcon,
  SearchDialogInput,
  SearchDialogList,
  SearchDialogOverlay,
  type SharedProps,
} from 'fumadocs-ui/components/dialog/search';
import { useDocsSearch } from 'fumadocs-core/search/client';
import { oramaStaticClient } from 'fumadocs-core/search/client/orama-static';
import { create } from '@orama/orama';
import { useI18n } from 'fumadocs-ui/contexts/i18n';

function initOrama() {
  return create({
    schema: { _: 'string' },
    // https://docs.orama.com/docs/orama-js/supported-languages
    language: 'english',
  });
}

// `from` defaults to "/api/search", an ABSOLUTE path that ignores basePath.
// This site is served at /docs, so the default would request /api/search on
// the real origin -- which is not a 404 but the MyGist API, sitting behind an
// auth middleware that guards every path starting /api. Search would fail with
// a 401 and no obvious cause.
//
// basePath is not readable at runtime in a static export, so it is repeated
// here. next.config.mjs carries the matching comment; the two must move
// together, and this is one of the four coupled pieces the design doc names as
// the ongoing cost of static search -- re-verify it on every Fumadocs upgrade
// by grepping the built bundle for the URL it actually requests.
const SEARCH_INDEX_URL = '/docs/api/search';

export default function DefaultSearchDialog(props: SharedProps) {
  const { locale } = useI18n(); // (optional) for i18n
  const { search, setSearch, query } = useDocsSearch({
    client: oramaStaticClient({
      from: SEARCH_INDEX_URL,
      initOrama,
      locale,
    }),
  });

  return (
    <SearchDialog search={search} onSearchChange={setSearch} isLoading={query.isLoading} {...props}>
      <SearchDialogOverlay />
      <SearchDialogContent>
        <SearchDialogHeader>
          <SearchDialogIcon />
          <SearchDialogInput />
          <SearchDialogClose />
        </SearchDialogHeader>
        <SearchDialogList items={query.data !== 'empty' ? query.data : null} />
      </SearchDialogContent>
    </SearchDialog>
  );
}

import { source } from '@/lib/source';
import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { baseOptions } from '@/lib/layout.shared';
import { DocsRootScope } from '@/components/docs-root-scope';

export default function Layout({ children }: LayoutProps<'/'>) {
  return (
    <DocsRootScope>
      <DocsLayout tree={source.getPageTree()} {...baseOptions()}>
        {children}
      </DocsLayout>
    </DocsRootScope>
  );
}

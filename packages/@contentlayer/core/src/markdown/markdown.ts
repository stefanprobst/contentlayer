import { errorToString } from '@contentlayer/utils'
import type { HasConsole } from '@contentlayer/utils/effect'
import { OT, pipe, T, Tagged } from '@contentlayer/utils/effect'
import * as path from 'node:path'
import rehypeStringify from 'rehype-stringify'
import remarkFrontmatter from 'remark-frontmatter'
import remarkGfm from 'remark-gfm'
import remarkParse from 'remark-parse'
import remark2rehype from 'remark-rehype'
import { unified } from 'unified'
import type { Data } from 'vfile'
import { VFile } from 'vfile'
import { matter } from 'vfile-matter'

import type { MarkdownOptions, MarkdownProcessor } from '../plugin.js'

export const markdownToHtml = ({
  mdString,
  options,
  contentDirPath,
  contentFilePath,
}: {
  mdString: string
  options?: MarkdownOptions | MarkdownProcessor
  contentDirPath: string
  contentFilePath?: string
}): T.Effect<OT.HasTracer & HasConsole, UnexpectedMarkdownError, { html: string; data: Data }> =>
  pipe(
    T.gen(function* ($) {
      if (process.env['CL_FAST_MARKDOWN']) {
        // NOTE `markdown-wasm` is an optional peer dependency
        return yield* $(
          T.tryPromise(async () => {
            const { parse: parseWasm } = await import('markdown-wasm/dist/markdown.node.js')
            return { html: parseWasm(mdString), data: {} }
          }),
        )
      }

      // TODO: don't use `process.cwd()` but instead `HasCwd`
      function getAbsoluteContentDirPath() {
        return path.isAbsolute(contentDirPath) ? contentDirPath : path.join(process.cwd(), contentDirPath)
      }

      const sourceFilePath =
        contentFilePath != null ? path.join(getAbsoluteContentDirPath(), contentFilePath) : undefined

      if (typeof options === 'function') {
        const res = yield* $(T.tryPromise(() => options(mdString, sourceFilePath)))
        return { html: res.html, data: res.data ?? {} }
      }

      const input = new VFile({ value: mdString, path: sourceFilePath })

      matter(input)

      const processor = unified()
        .use(remarkParse as any)
        .use(remarkFrontmatter)
        .use(remarkGfm)
        .use(options?.remarkPlugins ?? [])
        .use(remark2rehype, options?.remarkRehypeOptions)
        .use(options?.rehypePlugins ?? [])
        .use(rehypeStringify as any)

      const output = yield* $(T.tryPromise(() => processor.process(input)))

      return { html: String(output), data: output.data }
    }),
    T.catchAllDefect(T.fail),
    T.mapError((error) => new UnexpectedMarkdownError({ error })),
    OT.withSpan('@contentlayer/core/markdown:markdownToHtml'),
  )

export class UnexpectedMarkdownError extends Tagged('UnexpectedMarkdownError')<{ readonly error: unknown }> {
  toString = () => `UnexpectedMarkdownError: ${errorToString(this.error)}`
}

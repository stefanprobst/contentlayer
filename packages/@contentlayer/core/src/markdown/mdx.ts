import { errorToString } from '@contentlayer/utils'
import { OT, pipe, T, Tagged } from '@contentlayer/utils/effect'
import * as mdxBundler from 'mdx-bundler'
import type { BundleMDXOptions } from 'mdx-bundler/dist/types'
import * as path from 'node:path'
import type { Data } from 'vfile'
import { VFile } from 'vfile'
import { matter } from 'vfile-matter'

import type { MDXOptions, MDXProcessor } from '../plugin.js'

export const mdxToJs = ({
  mdxString,
  options,
  contentDirPath,
  contentFilePath,
}: {
  mdxString: string
  options?: MDXOptions | MDXProcessor
  contentDirPath: string
  contentFilePath?: string
}): T.Effect<OT.HasTracer, UnexpectedMDXError, { code: string; data: Data }> =>
  pipe(
    T.gen(function* ($) {
      // TODO: don't use `process.cwd()` but instead `HasCwd`
      function getAbsoluteContentDirPath() {
        return path.isAbsolute(contentDirPath) ? contentDirPath : path.join(process.cwd(), contentDirPath)
      }

      const sourceFilePath =
        contentFilePath != null ? path.join(getAbsoluteContentDirPath(), contentFilePath) : undefined

      if (typeof options === 'function') {
        const res = yield* $(T.tryPromise(() => options(mdxString, sourceFilePath)))
        return { code: res.code, data: res.data ?? {} }
      }

      const {
        remarkPlugins,
        remarkRehypeOptions,
        rehypePlugins,
        recmaPlugins,
        cwd = getAbsoluteContentDirPath(),
        ...restOptions
      } = options ?? {}

      const mdxOptions: BundleMDXOptions<any> = {
        mdxOptions(opts) {
          opts.remarkPlugins = [...(opts.remarkPlugins ?? []), ...(remarkPlugins ?? [])]
          opts.remarkRehypeOptions = { ...opts.remarkRehypeOptions, ...remarkRehypeOptions }
          opts.rehypePlugins = [...(opts.rehypePlugins ?? []), ...(rehypePlugins ?? [])]
          opts.recmaPlugins = [...(opts.recmaPlugins ?? []), ...(recmaPlugins ?? [])]
          return opts
        },
        cwd,
        ...restOptions,
      }

      const input = new VFile({ value: mdxString, path: sourceFilePath })

      matter(input)

      const res = yield* $(
        // @ts-expect-error FIXME: requires https://github.com/kentcdodds/mdx-bundler/pull/179
        T.tryPromise(() => mdxBundler.bundleMDX({ source: input, ...mdxOptions })),
      )

      if (res.errors.length > 0) {
        return yield* $(T.fail(res.errors))
      }

      return { code: res.code, data: { matter: res.frontmatter } }
    }),
    T.mapError((error) => new UnexpectedMDXError({ error })),
    OT.withSpan('@contentlayer/core/markdown:mdxToJs'),
  )

export class UnexpectedMDXError extends Tagged('UnexpectedMDXError')<{ readonly error: unknown }> {
  toString = () => `UnexpectedMDXError: ${errorToString(this.error)}`
}

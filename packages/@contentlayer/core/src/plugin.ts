import type { Thunk } from '@contentlayer/utils'
import type { E, HasClock, HasConsole, OT, S, T } from '@contentlayer/utils/effect'
import type * as mdxBundler from 'mdx-bundler/dist/types'
import type { Options as RemarkRehypeOptions } from 'remark-rehype'
import type { LiteralUnion } from 'type-fest'
import type * as unified from 'unified'
import type { Data } from 'vfile'

import type { HasCwd } from './cwd.js'
import type { DataCache } from './DataCache.js'
import type { SourceFetchDataError, SourceProvideSchemaError } from './errors.js'
import type { SchemaDef, StackbitExtension } from './schema/index.js'

export type SourcePluginType = LiteralUnion<'local' | 'contentful' | 'sanity', string>

export type PluginExtensions = {
  // TODO decentralized extension definitions + logic
  stackbit?: StackbitExtension.Config
}

export type PluginOptions = {
  markdown: MarkdownOptions | MarkdownProcessor | undefined
  mdx: MDXOptions | MDXProcessor | undefined
  date: DateOptions | undefined
  fieldOptions: FieldOptions
  disableImportAliasWarning: boolean
}

export type MarkdownOptions = {
  remarkPlugins?: unified.Pluggable[]
  remarkRehypeOptions?: RemarkRehypeOptions
  rehypePlugins?: unified.Pluggable[]
}

/**
 * Please make sure to use the following processing pipeline for Contentlayer to work properly:
 *
 * @example
 * ```ts
 * import rehypeStringify from 'rehype-stringify'
 * import remarkFrontmatter from 'remark-frontmatter'
 * import remarkGfm from 'remark-gfm'
 * import remarkParse from 'remark-parse'
 * import remark2rehype from 'remark-rehype'
 * import { unified } from 'unified'
 *
 * makeSource({
 *   // your other options ...
 *   async markdown(markdown, sourceFilePath) {
 *     const processor = unified()
 *       .use(remarkParse)
 *       .use(remarkFrontmatter)
 *       .use(remarkGfm)
 *       .use(remark2rehype)
 *       .use(rehypeStringify)
 *     const result = await processor.process({ value: markdown, path: sourceFilePath })
 *     return { html: String(result), data: result.data }
 *   }
 * })
 * ```
 */
export type MarkdownProcessor = (
  markdown: string,
  sourceFilePath: string | undefined,
) => Promise<{ html: string; data?: Data }>

export type MDXOptions = {
  remarkPlugins?: unified.Pluggable[]
  remarkRehypeOptions?: RemarkRehypeOptions
  rehypePlugins?: unified.Pluggable[]
  recmaPlugins?: unified.Pluggable[]
} & Omit<mdxBundler.BundleMDXOptions<any>, 'mdxOptions'>

/**
 * Please make sure to use one of the following processing pipelines for Contentlayer to work properly:
 *
 * @example
 * ```ts
 * import remarkGfm from 'remark-gfm'
 * import { bundleMDX } from 'mdx-bundler'
 *
 * makeSource({
 *   // your other options ...
 *   async markdown(markdown, sourceFilePath) {
 *     const result = await bundleMDX({ source: { value: markdown, path: sourceFilePath } }, {
 *       mdxOptions(options) {
 *         options.remarkPlugins = [...options.remarkPlugins, remarkGfm]
 *         return options
 *       }
 *     })
 *     return { code: result.code }
 *   }
 * })
 * ```
 *
 * @example
 * ```ts
 * import remarkFrontmatter from 'remark-frontmatter'
 * import remarkGfm from 'remark-gfm'
 * import { compile } from '@mdx-js/mdx'
 *
 * makeSource({
 *   // your other options ...
 *   async markdown(markdown, sourceFilePath) {
 *     const result = await compile({ value: markdown, path: sourceFilePath }, {
 *       remarkPlugins: [remarkFrontmatter, remarkGfm],
 *     })
 *     return { code: String(result), data: result.data }
 *   }
 * })
 * ```

 */
export type MDXProcessor = (mdx: string, sourceFilePath: string | undefined) => Promise<{ code: string; data?: Data }>

export type DateOptions = {
  /**
   * Use provided timezone (e.g. `America/New_York`)
   *
   * Based on: https://github.com/marnusw/date-fns-tz#zonedtimetoutc
   */
  timezone?: string
}

export type FieldOptions = {
  // TODO add to Jsdoc that `bodyFieldName` is just about the field name of the generated document type + data.
  // not about some front matter (as opposed to `typeFieldName` which concerns the front matter as well)
  /**
   * Name of the field containing the body/content extracted when `contentType` is `markdown` or `mdx`.
   * @default "body"
   */
  bodyFieldName: string

  /**
   * Name of the field containing the name of the document type (or nested document type).
   * @default "type"
   */
  typeFieldName: string
}

export type SourcePlugin = {
  type: SourcePluginType
  provideSchema: ProvideSchema
  fetchData: FetchData
} & {
  options: PluginOptions
  extensions: PluginExtensions
}

export type ProvideSchema = (
  esbuildHash: string,
) => T.Effect<OT.HasTracer & HasConsole, SourceProvideSchemaError, SchemaDef>
export type FetchData = (_: {
  schemaDef: SchemaDef
  verbose: boolean
}) => S.Stream<
  OT.HasTracer & HasClock & HasCwd & HasConsole,
  never,
  E.Either<SourceFetchDataError | SourceProvideSchemaError, DataCache.Cache>
>

// export type MakeSourcePlugin = (
//   _: Args | Thunk<Args> | Thunk<Promise<Args>>,
// ) => Promise<core.SourcePlugin>

export type MakeSourcePlugin<TArgs extends PartialArgs> = (
  _: TArgs | Thunk<TArgs> | Thunk<Promise<TArgs>>,
) => Promise<SourcePlugin>

export type PartialArgs = {
  markdown?: MarkdownOptions | MarkdownProcessor | undefined
  mdx?: MDXOptions | MDXProcessor | undefined
  date?: DateOptions | undefined
  fieldOptions?: Partial<FieldOptions>
  extensions?: PluginExtensions
  disableImportAliasWarning?: boolean
}

export const defaultFieldOptions: FieldOptions = {
  bodyFieldName: 'body',
  typeFieldName: 'type',
}

export const processArgs = async <TArgs extends PartialArgs>(
  argsOrArgsThunk: TArgs | Thunk<TArgs> | Thunk<Promise<TArgs>>,
): Promise<{
  extensions: PluginExtensions
  options: PluginOptions
  restArgs: Omit<TArgs, 'extensions' | 'fieldOptions' | 'markdown' | 'mdx' | 'date' | 'disableImportAliasWarning'>
}> => {
  const { extensions, fieldOptions, markdown, mdx, date, disableImportAliasWarning, ...restArgs } =
    typeof argsOrArgsThunk === 'function' ? await argsOrArgsThunk() : argsOrArgsThunk

  const options: PluginOptions = {
    markdown,
    mdx,
    date,
    fieldOptions: {
      bodyFieldName: fieldOptions?.bodyFieldName ?? defaultFieldOptions.bodyFieldName,
      typeFieldName: fieldOptions?.typeFieldName ?? defaultFieldOptions.typeFieldName,
    },
    disableImportAliasWarning: disableImportAliasWarning ?? false,
  }

  return { extensions: extensions ?? {}, options, restArgs }
}

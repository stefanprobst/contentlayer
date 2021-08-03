const getSanitySchema = require('@sanity/core/lib/actions/graphql/getSanitySchema')
import * as Core from '@contentlayer/core'
import { hashObject } from '@contentlayer/core'
import { pattern, pick } from '@contentlayer/utils'
import type Schema from '@sanity/schema'

import type * as Sanity from './sanity-types'

export const provideSchema = async (studioDirPath: string): Promise<Core.SchemaDef> => {
  const schema: Schema = getSanitySchema(studioDirPath)
  const types = schema._original.types

  // ;(await import('fs')).writeFileSync('schema.json', JSON.stringify(types, null, 2))

  const documentTypes = types
    .filter((_): _ is Sanity.DocumentType => _.type === 'document')
    .filter((_) => !_.name.startsWith('sanity.'))
  const nestedTypes = types.filter((_): _ is Sanity.ObjectType => _.type === 'object')

  const nestedTypeNames = nestedTypes.map((_) => _.name)

  const documentTypeDefMap: Core.DocumentTypeDefMap = documentTypes
    .map(sanityDocumentTypeToCoreDocumentDef(nestedTypeNames))
    .map(sanitizeDef)
    .reduce((acc, _) => ({ ...acc, [_.name]: _ }), {})

  const usedObjectTypes = collectUsedObjectTypes({ documentTypes, nestedTypes })
  const nestedTypeDefMap: Core.NestedTypeDefMap = usedObjectTypes
    .map(sanityObjectTypeToCoreObjectDef(nestedTypeNames))
    .map(sanitizeDef)
    .reduce((acc, _) => ({ ...acc, [_.name]: _ }), {})

  const defs = { documentTypeDefMap, nestedTypeDefMap }
  const hash = hashObject(defs)

  const coreSchemaDef = { ...defs, hash }

  Core.validateSchema(coreSchemaDef)

  return coreSchemaDef
}

/**
 * Looks for object types that were referenced (directly or indirectly) through at least one document type.
 */
const collectUsedObjectTypes = ({
  documentTypes,
  nestedTypes,
}: {
  documentTypes: Sanity.DocumentType[]
  nestedTypes: Sanity.ObjectType[]
}): Sanity.ObjectType[] => {
  const sanityObjectTypeMap: { [typeName: string]: Sanity.ObjectType } = nestedTypes.reduce(
    (acc, _) => ({ ...acc, [_.name]: _ }),
    {},
  )
  const visitedObjectTypes: { [typeName: string]: boolean } = {}
  const traverseObjectType = (objectType: Sanity.ObjectType) => {
    if (objectType.name in visitedObjectTypes) {
      return
    }

    visitedObjectTypes[objectType.name] = true

    objectType.fields.forEach(traverseField)
  }

  const traverseField = (field: Sanity.Field) => {
    switch (field.type) {
      case 'object':
        return field.fields.forEach(traverseField)
      case 'array':
        return field.of.map(traverseArrayOf)
      default:
        if (field.type in sanityObjectTypeMap) {
          traverseObjectType(sanityObjectTypeMap[field.type])
        }
    }
  }

  const traverseArrayOf = (arrayOf: Sanity.ArrayOf) => {
    switch (arrayOf.type) {
      case 'object':
        return arrayOf.fields.forEach(traverseField)
      default:
        if (arrayOf.type in sanityObjectTypeMap) {
          traverseObjectType(sanityObjectTypeMap[arrayOf.type])
        }
    }
  }

  documentTypes.flatMap((_) => _.fields).forEach(traverseField)

  return Object.keys(visitedObjectTypes).map((_) => sanityObjectTypeMap[_])
}

const sanityDocumentTypeToCoreDocumentDef =
  (objectTypeNames: string[]) =>
  (documentType: Sanity.DocumentType): Core.DocumentTypeDef => {
    // const previewSelectValues = Object.values(documentType.preview?.select ?? {})
    return {
      _tag: 'DocumentTypeDef',
      name: documentType.name,
      // label: documentType.title ?? '',
      description: undefined,
      isSingleton: false,
      // labelField: previewSelectValues.length > 0 ? previewSelectValues[0] : undefined,
      fieldDefs: documentType.fields.map(sanityFieldToCoreFieldDef(objectTypeNames)),
      computedFields: [],
      extensions: {},
    }
  }

const sanityObjectTypeToCoreObjectDef =
  (objectTypeNames: string[]) =>
  (objectType: Sanity.ObjectType): Core.NestedTypeDef => {
    return {
      _tag: 'NestedTypeDef',
      name: objectType.name,
      // label: objectType.title ?? '',
      description: objectType.description,
      fieldDefs: objectType.fields.map(sanityFieldToCoreFieldDef(objectTypeNames)),
      // labelField: undefined,
      extensions: {},
    }
  }

const sanityMockRule = new Proxy<Sanity.RuleType>({} as any, {
  get: (_target, prop) => {
    if (prop === 'required') {
      return () => true
    } else {
      return () => false
    }
  },
})

const sanityFieldToCoreFieldDef =
  (objectTypeNames: string[]) =>
  (field: Sanity.Field): Core.FieldDef => {
    const isRequired = field.validation?.(sanityMockRule) as boolean | undefined
    const baseFields = { ...pick(field, ['description', 'name']), isRequired, isSystemField: false }
    switch (field.type) {
      case 'reference':
        return <Core.ReferenceFieldDef>{
          ...baseFields,
          type: 'reference',
          // TODO support polymorphic references
          documentTypeName: field.to[0].type,
        }
      case 'array':
        // special handling for enum array
        if ((field.options as any)?.list) {
          return <Core.ListFieldDef>{
            ...baseFields,
            type: 'list',
            of: <Core.ListFieldDefItem.ItemEnum>{ type: 'enum', options: (field.options as any).list },
          }
        }

        if (field.of.length === 1) {
          return <Core.ListFieldDef>{
            ...baseFields,
            type: 'list',
            of: sanityArrayOfToCoreFieldListDefItem(objectTypeNames)(field.of[0]),
          }
        }

        return <Core.ListPolymorphicFieldDef>{
          ...baseFields,
          type: 'list_polymorphic',
          of: field.of.map(sanityArrayOfToCoreFieldListDefItem(objectTypeNames)),
          typeField: '_type',
        }
      case 'object':
        return <Core.NestedUnnamedFieldDef>{
          ...baseFields,
          type: 'nested_unnamed',
          typeDef: {
            _tag: 'NestedUnnamedTypeDef',
            fieldDefs: field.fields.map(sanityFieldToCoreFieldDef(objectTypeNames)),
            extensions: {},
          },
        }
      case 'date':
      case 'datetime': {
        return <Core.DateFieldDef>{
          ...baseFields,
          type: 'date',
          // label: field.title,
          // hidden: field.hidden,
        }
      }
      case 'string': {
        // special handling for enum
        if (field.options?.list) {
          return <Core.EnumFieldDef>{
            ...baseFields,
            type: 'enum',
            options: field.options.list,
            // label: field.title,
            // hidden: field.hidden,
          }
        }
      }
      case 'markdown':
      case 'url':
      case 'image':
      case 'slug':
      case 'boolean':
      case 'number':
      case 'text': {
        type FieldDef = Core.MarkdownFieldDef | Core.BooleanFieldDef | Core.NumberFieldDef | Core.StringFieldDef
        const type = pattern
          .match(field.type)
          .when(
            (_) => _ === 'boolean' || _ === 'markdown' || _ === 'number',
            (_) => _,
          )
          .otherwise(() => 'string' as const)
        return <FieldDef>{
          ...baseFields,
          type,
          // label: field.title,
          // hidden: field.hidden,
        }
      }
      case 'block':
      default: {
        if (objectTypeNames.includes(field.type)) {
          return <Core.NestedFieldDef>{
            ...baseFields,
            type: 'nested',
            nestedTypeName: field.type,
          }
        }

        throw new Error(`Case not implemented ${field.type}`)
      }
    }
  }

const sanityArrayOfToCoreFieldListDefItem =
  (objectTypeNames: string[]) =>
  (arrayOf: Sanity.ArrayOf): Core.ListFieldDefItem.Item => {
    switch (arrayOf.type) {
      case 'string':
        return <Core.ListFieldDefItem.ItemString>{ type: 'string' }
      case 'reference':
        return <Core.ListFieldDefItem.ItemReference>{
          type: 'reference',
          // TODO support polymorphic references
          documentTypeName: arrayOf.to[0].type,
        }
      case 'object':
        return <Core.ListFieldDefItem.ItemNestedUnnamed>{
          type: 'nested_unnamed',
          typeDef: {
            _tag: 'NestedUnnamedTypeDef',
            fieldDefs: arrayOf.fields.map(sanityFieldToCoreFieldDef(objectTypeNames)),
            extensions: {},
          },
        }
      default:
        if (objectTypeNames.includes(arrayOf.type)) {
          return <Core.ListFieldDefItem.ItemNested>{ type: 'nested', nestedTypeName: arrayOf.type }
        }

        throw new Error(`Case not implemented ${arrayOf.type}`)
    }
  }

const sanitizeString = (_: string): string => _.replace(/\./g, '_')

/** Sanitizes the schema definition (e.g. replace "." with "_" in type names) */
const sanitizeDef = <TypeDef extends Core.NestedTypeDef | Core.DocumentTypeDef>(def: TypeDef): TypeDef => {
  def.name = sanitizeString(def.name)
  def.fieldDefs.forEach((fieldDef) => {
    fieldDef.name = sanitizeString(fieldDef.name)
    switch (fieldDef.type) {
      case 'nested':
        fieldDef.nestedTypeName = sanitizeString(fieldDef.nestedTypeName)
        break
      case 'reference':
        fieldDef.documentTypeName = sanitizeString(fieldDef.documentTypeName)
        break
      case 'list_polymorphic':
        fieldDef.of.forEach(sanitizeListItemDef)
        break
      case 'list':
        sanitizeListItemDef(fieldDef.of)
        break
    }
  })

  return def
}

const sanitizeListItemDef = (item: Core.ListFieldDefItem.Item): void => {
  switch (item.type) {
    case 'nested':
      item.nestedTypeName = sanitizeString(item.nestedTypeName)
      break
    case 'reference':
      item.documentTypeName = sanitizeString(item.documentTypeName)
      break
  }
}

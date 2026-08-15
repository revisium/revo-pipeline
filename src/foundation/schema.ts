import { Type, type TObject, type TProperties } from 'typebox';

export const closedObject = <const Properties extends TProperties>(
  properties: Properties,
): TObject<Properties> => Type.Object(properties, { additionalProperties: false });

/**
 * NLP Module - Text Parsing and LLM Integration
 *
 * Converts raw geometry problem text into a structured DSL (Domain Specific Language)
 * and GeometryModel with identified constraints.
 */

export { parseGeometryProblem } from './parser.js';
export { parseGeometryProblemWithLLM } from './llmParser.js';
export { dslToGeometryModel, canonicalToGeometryModel, expandDslMacros } from '../dsl/dsl.js';
export { parseGeometryDslWithLLM } from './dslParser.js';
export type { GeometryDsl } from '../dsl/dsl.js';

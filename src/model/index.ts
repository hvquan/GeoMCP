/**
 * Model Module - Type Definitions and DSL Processing
 *
 * Defines the core data structures (GeometryModel) and provides utilities
 * to enrich the model with derived information.
 */

// Re-export from v2Model
export { enrichModelForV2 } from './v2Model.js';

// Re-export normalize utilities
export { normalizeModelIds, displayLabel } from './normalize.js';

// Re-export all types from the types module
export * from './types.js';

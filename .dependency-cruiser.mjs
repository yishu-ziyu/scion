import { cruiseOptions, forbidden } from './scripts/lib/structure-rules.mjs';

/** @type {import('dependency-cruiser').IConfiguration} */
export default {
  forbidden,
  options: cruiseOptions,
};

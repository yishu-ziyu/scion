/**
 * Shared name/price/rating field rules for product cards.
 * Used by the generic extract walker and by extractProductsFromHtml.
 */

export const STAR_RATING_WORDS: Record<string, string> = {
  one: '1',
  two: '2',
  three: '3',
  four: '4',
  five: '5',
};

export type ProductCardNode = {
  tag: string;
  attrs: Record<string, string>;
};

export function ratingFromStarRatingClass(className: string): string {
  const tokens = className.trim().split(/\s+/);
  if (!tokens.some(token => /^star-rating$/i.test(token))) return '';
  const word = tokens.find(token => STAR_RATING_WORDS[token.toLowerCase()]);
  return word ? STAR_RATING_WORDS[word.toLowerCase()] : '';
}

export function nameFromAnchorTitle(title: string): string {
  return title.trim();
}

export function priceFromPriceColorClass(className: string, text: string): string {
  if (!/\bprice_color\b/i.test(className)) return '';
  return text.trim();
}

export function nameFromItemprop(attrs: Record<string, string>, text: string): string {
  if ((attrs.itemprop || '').trim().toLowerCase() !== 'name') return '';
  return (attrs.content || attrs.title || text).trim();
}

export function priceFromItemprop(attrs: Record<string, string>, text: string): string {
  if ((attrs.itemprop || '').trim().toLowerCase() !== 'price') return '';
  return (attrs.content || attrs.title || text).trim();
}

export function ratingFromDataRating(attrs: Record<string, string>): string {
  return (attrs['data-rating'] || '').trim();
}

export function applyProductCardSemanticFields(
  node: ProductCardNode,
  row: Record<string, string>,
  text: string,
): void {
  if (!row.name) {
    const name = nameFromAnchorTitle(node.tag === 'a' ? node.attrs.title || '' : '') || nameFromItemprop(node.attrs, text);
    if (name) row.name = name;
  }
  if (!row.price) {
    const price = priceFromPriceColorClass(node.attrs.class || '', text) || priceFromItemprop(node.attrs, text);
    if (price) row.price = price;
  }
  if (!row.rating) {
    const rating = ratingFromStarRatingClass(node.attrs.class || '') || ratingFromDataRating(node.attrs);
    if (rating) row.rating = rating;
  }
}

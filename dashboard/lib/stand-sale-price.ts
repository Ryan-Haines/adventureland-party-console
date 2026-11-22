export const maxStandSalePrice = 99_999_999_999;
export const standSalePriceError = `Enter a whole gold price from 1 to ${maxStandSalePrice.toLocaleString("en-US")}.`;

export function validStandSalePrice(price: unknown): boolean {
  return typeof price === "number" && Number.isSafeInteger(price) && price >= 1 && price <= maxStandSalePrice;
}

export function activeStandSale(listing: { state?: string; price?: unknown }): boolean {
  return listing.state !== "paused" && validStandSalePrice(listing.price);
}

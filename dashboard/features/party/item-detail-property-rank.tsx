"use client";
import { ITEM_DETAIL_PROPERTY_ORDER } from "./item-detail-property-order";

export const ITEM_DETAIL_PROPERTY_RANK = new Map(
  ITEM_DETAIL_PROPERTY_ORDER.map((key, index) => [key, index]),
);

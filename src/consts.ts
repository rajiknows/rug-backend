// --- Simple In-Memory Cache for Report Summary ---
// NOTE: For production, consider a more robust solution like Redis or Memcached.
export interface ReportSummary {
    // Define the structure based on the actual API response
    [key: string]: unknown;
}

export interface CacheEntry<T> {
    data: T;
    expiry: number; // Timestamp when the cache expires
}

export const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes cache

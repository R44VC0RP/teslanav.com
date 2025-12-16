// TeslaNav Service Worker for Map Tile Caching
// Caches Mapbox tiles for 7 days to reduce API calls

const CACHE_NAME = 'teslanav-tiles-v1';
const TILE_CACHE_DURATION = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

// Patterns for resources we want to cache
const CACHEABLE_PATTERNS = [
  /api\.mapbox\.com\/v4\//,           // Vector tiles
  /api\.mapbox\.com\/styles\//,        // Style resources
  /api\.mapbox\.com\/fonts\//,         // Fonts/glyphs
  /api\.mapbox\.com\/mapbox-terrain/,  // Terrain tiles (DEM)
  /tiles\.mapbox\.com/,                // Tile CDN
];

// Install event - set up cache
self.addEventListener('install', (event) => {
  console.log('[SW] Service Worker installing for tile caching');
  self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
  console.log('[SW] Service Worker activating');
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames
          .filter((name) => name.startsWith('teslanav-') && name !== CACHE_NAME)
          .map((name) => {
            console.log('[SW] Deleting old cache:', name);
            return caches.delete(name);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// Check if URL should be cached
function shouldCache(url) {
  return CACHEABLE_PATTERNS.some((pattern) => pattern.test(url));
}

// Check if cached response is still valid
function isCacheValid(response) {
  if (!response) return false;
  
  const cachedTime = response.headers.get('sw-cached-time');
  if (!cachedTime) return false;
  
  const age = Date.now() - parseInt(cachedTime, 10);
  return age < TILE_CACHE_DURATION;
}

// Fetch event - intercept and cache tile requests
self.addEventListener('fetch', (event) => {
  const url = event.request.url;
  
  // Only handle GET requests for cacheable resources
  if (event.request.method !== 'GET' || !shouldCache(url)) {
    return;
  }
  
  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Try to get from cache first
      const cachedResponse = await cache.match(event.request);
      
      if (cachedResponse && isCacheValid(cachedResponse)) {
        // Return cached response if still valid
        return cachedResponse;
      }
      
      // Fetch from network
      try {
        const networkResponse = await fetch(event.request);
        
        // Only cache successful responses
        if (networkResponse.ok) {
          // Clone the response and add our cache timestamp header
          const responseToCache = networkResponse.clone();
          const headers = new Headers(responseToCache.headers);
          headers.set('sw-cached-time', Date.now().toString());
          
          const cachedResponseBody = await responseToCache.blob();
          const modifiedResponse = new Response(cachedResponseBody, {
            status: responseToCache.status,
            statusText: responseToCache.statusText,
            headers: headers,
          });
          
          // Store in cache (don't await - do it in background)
          cache.put(event.request, modifiedResponse.clone());
        }
        
        return networkResponse;
      } catch (error) {
        // If network fails and we have a stale cache, return it
        if (cachedResponse) {
          console.log('[SW] Network failed, returning stale cache for:', url);
          return cachedResponse;
        }
        throw error;
      }
    })
  );
});

// Handle messages from the main thread
self.addEventListener('message', (event) => {
  if (event.data.type === 'CLEAR_TILE_CACHE') {
    caches.delete(CACHE_NAME).then(() => {
      console.log('[SW] Tile cache cleared');
      event.ports[0].postMessage({ success: true });
    });
  }
  
  if (event.data.type === 'GET_CACHE_SIZE') {
    caches.open(CACHE_NAME).then(async (cache) => {
      const keys = await cache.keys();
      let totalSize = 0;
      
      for (const request of keys) {
        const response = await cache.match(request);
        if (response) {
          const blob = await response.clone().blob();
          totalSize += blob.size;
        }
      }
      
      event.ports[0].postMessage({ 
        count: keys.length,
        size: totalSize,
        sizeFormatted: formatBytes(totalSize)
      });
    });
  }
});

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

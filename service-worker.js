const CACHE_NAME = "password-generator-v0.1.1";

console.debug("started service worker");

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const files = ["/index.html", "/main.js", "/favicon.svg"];
      cache.addAll(files);
      console.debug(`service worker cached files: ${files} in ${CACHE_NAME}`);
    })()
  );
});

self.addEventListener("fetch", (event) => {
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      const cachedResponse = await cache.match(event.request);
      if (cachedResponse) {
        console.debug("service worker fetch (from cache):", event.request.url);
        return cachedResponse;
      } else {
        try {
          const fetchResponse = await fetch(event.request);
          const url = event.request.url;
          if (url.startsWith("chrome-extension") || url.includes("extension") || !(url.indexOf("http") === 0)) {
            console.debug("service worker fetch (without cache.put):", url);
            return fetchResponse;
          } else {
            console.debug("service worker fetch (with cache.put):", url);
            cache.put(event.request, fetchResponse.clone());
            return fetchResponse;
          }
        } catch (e) {
          console.warn("service worker fetch error: ", e);
        }
      }
    })()
  );
});

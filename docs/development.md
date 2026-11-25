# Development

Serve the game over HTTP. With Node.js installed, run npm start. Without Node.js, use Python with py -m http.server 8000 and open http://localhost:8000. Do not open index.html as a file because browser modules require HTTP.

When Node.js is available, npm run check performs the configured JavaScript syntax check. Keep balance values in data/stats/ and hero-specific behavior in heroes/. Update the matching data/unit-descriptions/<id>.md when mechanics or stats change.

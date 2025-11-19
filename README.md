## jobs-ch-scraper (Playwright + Express) — Railway-ready

Scrapes jobs from jobs.ch search results using a headless Chromium via Playwright. Exposes an HTTP API for easy integration (e.g., from n8n). The publication date filter is fixed to 7 days as requested.

### Endpoint

- `GET /scrape?term=software%20engineer&maxPages=3`
  - **term**: job title or keywords (required; default: `software engineer`)
  - **maxPages**: maximum number of result pages to follow (default: `5`)
  - Always applies `publication-date=7` days.

Response:

```json
{
  "meta": {
    "term": "software engineer",
    "maxPages": 3,
    "publicationDateDays": 7,
    "count": 123,
    "source": "https://www.jobs.ch/en/vacancies/?publication-date=7"
  },
  "data": [
    {
      "title": "Software Engineer",
      "company": "Digitec Galaxus AG",
      "location": "Zürich",
      "workload": "80 – 100%",
      "contractType": "Unlimited employment",
      "postedText": "Yesterday",
      "link": "https://www.jobs.ch/en/vacancies/detail/..."
    }
  ]
}
```

Source reference: [jobs.ch 7-day software engineer search](https://www.jobs.ch/en/vacancies/?publication-date=7&term=software%20engineer)

### Run locally

Requirements: Node 18+, Docker optional for parity with Railway.

Without Docker:

```bash
cd jobs-ch-scraper
npm ci
npx playwright install --with-deps
npm start
# Open http://localhost:3000/healthz
# Test: http://localhost:3000/scrape?term=software%20engineer&maxPages=3
```

With Docker:

```bash
cd jobs-ch-scraper
docker build -t jobs-ch-scraper .
docker run --rm -p 3000:3000 jobs-ch-scraper
# Test as above
```

### Deploy to Railway

1. Create a new Railway project and select “Deploy from repo” (or CLI).
2. Ensure it detects the Dockerfile. No extra config needed.
3. Set environment:
   - `PORT` (optional, default `3000`)
   - `MAX_PAGES` (optional, default `5`)
4. Deploy. Visit Railway’s generated domain: `/healthz` then `/scrape?term=software%20engineer`.

### Notes

- If jobs.ch markup changes, adjust selectors in `server.js`:
  - `extractPageJobs()` and `findNextPage()`
- The scraper tries to accept cookie banners automatically.
- Keep page count reasonable; add delays if you scale scraping volume.

### License

MIT



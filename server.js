/* eslint-disable no-console */
import express from 'express';
import { chromium } from 'playwright';

const app = express();
const PORT = process.env.PORT || 3000;

const BASE_URL = 'https://www.jobs.ch';
const SEARCH_PATH = '/en/vacancies/';
const DEFAULT_MAX_PAGES = Number.parseInt(process.env.MAX_PAGES || '5', 10);

const DEFAULT_HEADERS = {
	UserAgent:
		'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36',
	Locale: 'en-US,en;q=0.9',
};

function decodeEntities(text) {
	if (!text) return '';
	return text
		.replace(/&nbsp;/g, ' ')
		.replace(/&amp;/g, '&')
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&quot;/g, '"')
		.replace(/&#039;/g, "'")
		.replace(/&#x27;/g, "'")
		.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}

function stripHtml(html) {
	return decodeEntities(String(html || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function parseCardTextToFields(cardText) {
	const lines = String(cardText || '')
		.split('\n')
		.map((s) => s.trim())
		.filter(Boolean);

	const title = lines[0] || '';

	let company = '';
	for (let i = 1; i < lines.length; i++) {
		const l = lines[i];
		const isMeta =
			l.includes('Place of work:') ||
			l.includes('Workload:') ||
			l.includes('Contract type:') ||
			l.toLowerCase().includes('easy apply') ||
			/\b(week|day|hour|minute|month|yesterday|today|new)\b/i.test(l);
		if (!isMeta) {
			company = l;
			break;
		}
	}

	const findAfter = (label) => {
		const line = lines.find((l) => l.toLowerCase().startsWith(label.toLowerCase()));
		if (!line) return '';
		return line.replace(new RegExp(`^${label}\\s*`, 'i'), '').trim();
	};

	const location = findAfter('Place of work:');
	const workload = findAfter('Workload:');
	const contractType = findAfter('Contract type:');

	let postedText = '';
	for (let i = lines.length - 1; i >= 0; i--) {
		const l = lines[i];
		if (/\b(week|day|hour|minute|month|yesterday|today|new)\b/i.test(l)) {
			postedText = l;
			break;
		}
	}

	return { title, company, location, workload, contractType, postedText };
}

async function maybeAcceptCookies(page) {
	const consentButtons = [
		'button:has-text("Accept")',
		'button:has-text("I accept")',
		'button:has-text("Agree")',
		'button:has-text("Allow all")',
		'button:has-text("OK")',
		'button:has-text("Akzeptieren")',
		'button:has-text("Alle akzeptieren")',
		'button:has-text("Tout accepter")',
	];
	for (const sel of consentButtons) {
		try {
			const btn = page.locator(sel).first();
			if (await btn.isVisible({ timeout: 1000 })) {
				await btn.click({ timeout: 1000 });
				break;
			}
		} catch {
			// ignore
		}
	}
}

async function extractPageJobs(page) {
	// Evaluate anchors in main content that lead to vacancy pages
	const jobs = await page.$$eval('main a[href*="/vacanc"]', (anchors) => {
		function decodeEntitiesLocal(text) {
			if (!text) return '';
			return text
				.replace(/&nbsp;/g, ' ')
				.replace(/&amp;/g, '&')
				.replace(/&lt;/g, '<')
				.replace(/&gt;/g, '>')
				.replace(/&quot;/g, '"')
				.replace(/&#039;/g, "'")
				.replace(/&#x27;/g, "'")
				.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
		}
		function stripHtmlLocal(html) {
			return decodeEntitiesLocal(String(html || '').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
		}
		function parseCardTextLocal(cardText) {
			const lines = String(cardText || '')
				.split('\n')
				.map((s) => s.trim())
				.filter(Boolean);
			const title = lines[0] || '';
			let company = '';
			for (let i = 1; i < lines.length; i++) {
				const l = lines[i];
				const isMeta =
					l.includes('Place of work:') ||
					l.includes('Workload:') ||
					l.includes('Contract type:') ||
					l.toLowerCase().includes('easy apply') ||
					/\b(week|day|hour|minute|month|yesterday|today|new)\b/i.test(l);
				if (!isMeta) {
					company = l;
					break;
				}
			}
			const findAfter = (label) => {
				const line = lines.find((l) => l.toLowerCase().startsWith(label.toLowerCase()));
				if (!line) return '';
				return line.replace(new RegExp(`^${label}\\s*`, 'i'), '').trim();
			};
			const location = findAfter('Place of work:');
			const workload = findAfter('Workload:');
			const contractType = findAfter('Contract type:');
			let postedText = '';
			for (let i = lines.length - 1; i >= 0; i--) {
				const l = lines[i];
				if (/\b(week|day|hour|minute|month|yesterday|today|new)\b/i.test(l)) {
					postedText = l;
					break;
				}
			}
			return { title, company, location, workload, contractType, postedText };
		}

		const results = [];
		const seen = new Set();

		for (const a of anchors) {
			try {
				const href = a.getAttribute('href') || '';
				if (!href) continue;
				const url = href.startsWith('http') ? href : new URL(href, location.origin).href;
				if (!/\/vacanc/i.test(url)) continue;
				if (seen.has(url)) continue;
				seen.add(url);

				const innerHtml = a.innerHTML || '';
				const text = stripHtmlLocal(innerHtml);
				const hasMeta = /Place of work:|Workload:|Contract type:/i.test(text);
				if (!hasMeta) continue;

				// Prefer heading inside card
				let titleFromHeading = '';
				const heading =
					a.querySelector('h3, h2, [data-testid=\"job-title\"], .job-title') ||
					a.closest('article')?.querySelector('h3, h2, [data-testid=\"job-title\"], .job-title');
				if (heading) {
					titleFromHeading = stripHtmlLocal(heading.innerHTML);
				}
				const parsed = parseCardTextLocal(text);
				const title = titleFromHeading || parsed.title;
				results.push({
					title,
					company: parsed.company,
					location: parsed.location,
					workload: parsed.workload,
					contractType: parsed.contractType,
					postedText: parsed.postedText,
					link: url,
				});
			} catch {
				// ignore specific anchor errors
			}
		}
		return results;
	});
	return jobs;
}

async function findNextPage(page) {
	// rel="next"
	const relNext = page.locator('a[rel=\"next\"]');
	if (await relNext.count()) {
		try {
			if (await relNext.first().isVisible()) {
				return relNext.first();
			}
		} catch {
			// ignore
		}
	}
	// Visible anchor with text "Next"
	const nextBtn = page.locator('a:has-text(\"Next\")').first();
	if (await nextBtn.count()) {
		try {
			if (await nextBtn.isVisible()) return nextBtn;
		} catch {
			// ignore
		}
	}
	return null;
}

function buildSearchUrl(term) {
	const url = new URL(SEARCH_PATH, BASE_URL);
	url.searchParams.set('term', term);
	// Force published since 7 days as requested
	url.searchParams.set('publication-date', '7');
	return url.toString();
}

async function scrapeJobs({ term, maxPages = DEFAULT_MAX_PAGES }) {
	const browser = await chromium.launch({ headless: true });
	const context = await browser.newContext({
		userAgent: DEFAULT_HEADERS.UserAgent,
		locale: DEFAULT_HEADERS.Locale,
	});
	const page = await context.newPage();
	const detailsPage = await context.newPage();

	const allJobs = [];
	try {
		let url = buildSearchUrl(term);

		for (let i = 0; i < maxPages; i++) {
			await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
			await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
			await maybeAcceptCookies(page);

			const jobs = await extractPageJobs(page);
			const known = new Set(allJobs.map((j) => j.link));
			for (const j of jobs) {
				if (!known.has(j.link)) {
					allJobs.push(j);
					known.add(j.link);
				}
			}

			// Get next page link or break
			if (i === maxPages - 1) break;
			const nextEl = await findNextPage(page);
			if (!nextEl) break;
			await Promise.all([
				page.waitForLoadState('domcontentloaded', { timeout: 20000 }).catch(() => {}),
				nextEl.click({ timeout: 2000 }),
			]);
			await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
		}

		// Enrich each job with detail page info
		for (let idx = 0; idx < allJobs.length; idx++) {
			const job = allJobs[idx];
			try {
				await detailsPage.goto(job.link, { waitUntil: 'domcontentloaded', timeout: 60000 });
				await detailsPage.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {});
				await maybeAcceptCookies(detailsPage);

				// allow dynamic content to settle
				await detailsPage.waitForTimeout(1200);

				const detail = await detailsPage.evaluate(() => {
					function text(node) {
						return (node?.innerText || node?.textContent || '').trim();
					}

					function findValueByPrefix(prefix) {
						const re = new RegExp('^\\s*' + prefix.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&') + '\\s*:?\\s*(.+)$', 'i');
						// Scan common containers first
						const roots = Array.from(document.querySelectorAll('main, article, section')) || [document.body];
						for (const root of roots) {
							const tree = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, null);
							while (tree.nextNode()) {
								const el = tree.currentNode;
								const t = (el.innerText || el.textContent || '').trim();
								if (!t) continue;
								const m = t.match(re);
								if (m && m[1]) return m[1].trim();
								const exact = t.replace(':', '').trim().toLowerCase();
								if (exact === prefix.toLowerCase()) {
									const sib = el.nextElementSibling;
									if (sib) return text(sib);
								}
							}
						}
						return '';
					}

					// Try DL lists (dt -> dd)
					const dlValues = {};
					document.querySelectorAll('dl').forEach((dl) => {
						const dts = dl.querySelectorAll('dt');
						dts.forEach((dt) => {
							const label = (dt.innerText || dt.textContent || '').trim().replace(/:$/, '');
							const dd = dt.nextElementSibling && dt.nextElementSibling.tagName.toLowerCase() === 'dd' ? dt.nextElementSibling : null;
							if (!dd) return;
							const val = (dd.innerText || dd.textContent || '').trim();
							if (!label || !val) return;
							dlValues[label.toLowerCase()] = val;
						});
					});

					function valueFor(label) {
						const fromDl = dlValues[label.toLowerCase()];
						if (fromDl) return fromDl;
						return findValueByPrefix(label);
					}

					function extractDescription() {
						// Try to find a heading that implies description content
						const root = document.querySelector('main') || document.querySelector('article') || document.body;
						const headings = Array.from(root.querySelectorAll('h1, h2, h3'));
						for (const h of headings) {
							const ht = text(h);
							if (/Job description|Description|Responsibilities|Your tasks/i.test(ht)) {
								// Prefer next sibling block
								let target = h.nextElementSibling;
								if (target) {
									const t = text(target);
									if (t.split(/\s+/).length > 30) return t;
								}
								// Or the closest section wrapper
								let sec = h.closest('section') || h.parentElement;
								if (sec) {
									const t2 = text(sec);
									if (t2.split(/\s+/).length > 30) return t2;
								}
							}
						}
						// Fallback: longest paragraph block in main/article
						let best = '';
						(root.querySelectorAll('p, li') || []).forEach((el) => {
							const t = text(el);
							if (t.split(/\s+/).length > 20 && t.length > best.length) best = t;
						});
						return best;
					}

					const keyInfo = {
						publicationDate: valueFor('Publication date'),
						workload: valueFor('Workload'),
						contractType: valueFor('Contract type'),
						language: valueFor('Language'),
						placeOfWork: valueFor('Place of work'),
					};

					return {
						description: extractDescription(),
						keyInfo,
					};
				});

				job.description = detail.description;
				job.keyInfo = detail.keyInfo;

				// polite delay
				await detailsPage.waitForTimeout(200);
			} catch (e) {
				// Keep listing data even if details fail
				job.description = job.description || '';
				job.keyInfo = job.keyInfo || {
					publicationDate: '',
					workload: '',
					contractType: '',
					language: '',
					placeOfWork: '',
				};
			}
		}
	} finally {
		await browser.close();
	}
	return allJobs;
}

app.get('/healthz', (_req, res) => {
	res.json({ status: 'ok' });
});

// GET /scrape?term=software%20engineer&maxPages=3
app.get('/scrape', async (req, res) => {
	try {
		const termRaw = (req.query.term || '').toString().trim();
		const term = termRaw.length ? termRaw : 'software engineer';
		const maxPages = Number.parseInt((req.query.maxPages || '').toString(), 10) || DEFAULT_MAX_PAGES;
		const data = await scrapeJobs({ term, maxPages });
		res.json({
			meta: {
				term,
				maxPages,
				publicationDateDays: 7,
				count: data.length,
				source: 'https://www.jobs.ch/en/vacancies/?publication-date=7',
			},
			data,
		});
	} catch (err) {
		console.error(err);
		res.status(500).json({
			error: 'Scrape failed',
			message: err?.message || String(err),
		});
	}
});

app.listen(PORT, () => {
	console.log(`jobs-ch-scraper listening on port ${PORT}`);
});



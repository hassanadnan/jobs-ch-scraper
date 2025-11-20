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
		'#onetrust-accept-btn-handler',
		'button#onetrust-accept-btn-handler',
		'#didomi-notice-agree-button',
		'button[id="didomi-notice-agree-button"]',
		'[data-testid="uc-accept-all-button"]',
		'button[aria-label*="accept" i]',
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

async function maybeExpandDescription(page) {
	// Attempt to expand collapsible sections like "Show more"
	const expanders = [
		'button:has-text("Show more")',
		'button:has-text("Mehr anzeigen")',
		'button:has-text("Afficher plus")',
		'button[aria-expanded="false"]',
		'[data-testid="expand-button"]',
	];
	for (const sel of expanders) {
		try {
			const btns = page.locator(sel);
			const count = await btns.count();
			for (let i = 0; i < Math.min(count, 5); i++) {
				const b = btns.nth(i);
				if (await b.isVisible({ timeout: 500 })) {
					await b.click({ timeout: 500 }).catch(() => {});
					await page.waitForTimeout(150);
				}
			}
		} catch {
			// ignore
		}
	}
}

async function extractPageJobs(page) {
	// Evaluate anchors in main content that lead to vacancy pages
	let jobs = await page.$$eval('main a[href*="/vacanc"]', (anchors) => {
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

	// Fallback: broader selector if nothing found (structure may differ server-side)
	if (!jobs || jobs.length === 0) {
		jobs = await page.$$eval('a[href*="/vacancies/detail/"]', (anchors) => {
			function stripHtmlLocal(html) {
				return String(html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
			}
			const results = [];
			const seen = new Set();
			for (const a of anchors) {
				try {
					const href = a.getAttribute('href') || '';
					if (!href) continue;
					const url = href.startsWith('http') ? href : new URL(href, location.origin).href;
					if (seen.has(url)) continue;
					seen.add(url);
					const text = stripHtmlLocal(a.innerHTML || '');
					results.push({
						title: text.slice(0, 140),
						company: '',
						location: '',
						workload: '',
						contractType: '',
						postedText: '',
						link: url,
					});
				} catch {}
			}
			return results;
		});
	}
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
	const browser = await chromium.launch({
		headless: true,
		// Flags for containerized environments like Railway
		args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
	});
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

			// Give client-side rendering a moment and ensure elements exist
			await page.waitForTimeout(800);
			await page.waitForSelector('a[href*="/vacanc"], a[href*="/vacancies/detail/"]', { timeout: 8000 }).catch(() => {});

			// Try to trigger lazy loads by scrolling
			for (let s = 0; s < 3; s++) {
				await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
				await page.waitForTimeout(400);
			}

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
				await maybeExpandDescription(detailsPage);

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

					function normLabel(l) {
						return (l || '')
							.replace(/\s+/g, ' ')
							.replace(/\s*:\s*$/, '')
							.trim()
							.toLowerCase();
					}

					function canonicalKey(l) {
						return normLabel(l).replace(/[^a-z]/g, '');
					}

					// Parse all dl dt/dd pairs into a map
					const dlValues = {};
					(document.querySelectorAll('dl') || []).forEach((dl) => {
						(dl.querySelectorAll('dt') || []).forEach((dt) => {
							const label = normLabel(dt.innerText || dt.textContent || '');
							if (!label) return;
							const dd = dt.nextElementSibling && dt.nextElementSibling.tagName && dt.nextElementSibling.tagName.toLowerCase() === 'dd' ? dt.nextElementSibling : null;
							if (!dd) return;
							const val = (dd.innerText || dd.textContent || '').trim();
							if (!val) return;
							dlValues[canonicalKey(label)] = val;
							dlValues[label] = val; // also keep non-canonical for fallback
						});
					});

					// Fallback: scan small blocks with "Label: value"
					function scanPairs(labels) {
						const out = {};
						const roots = Array.from(document.querySelectorAll('main, article, section')) || [document.body];
						for (const root of roots) {
							const els = Array.from(root.querySelectorAll('p, li, div'));
							for (const el of els) {
								const t = (el.innerText || el.textContent || '').trim();
								if (!t || t.length > 600 || !t.includes(':')) continue;
								for (const label of labels) {
									const re = new RegExp('^\\s*' + label.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&') + '\\s*:?\\s*(.+)$', 'i');
									const m = t.match(re);
									if (m && m[1]) {
										out[canonicalKey(label)] = m[1].trim();
									}
								}
							}
						}
						return out;
					}

					function getBySynonyms(map, pairs, synonyms) {
						for (const key of Object.keys(map)) {
							const k = key.toLowerCase();
							for (const syn of synonyms) {
								const can = canonicalKey(syn);
								if (k === can || k.includes(can)) return map[key];
							}
						}
						for (const key of Object.keys(pairs)) {
							const k = key.toLowerCase();
							for (const syn of synonyms) {
								const can = canonicalKey(syn);
								if (k === can || k.includes(can)) return pairs[key];
							}
						}
						return '';
					}

					const synonyms = {
						publicationDate: ['Publication date', 'Published'],
						workload: ['Workload'],
						contractType: ['Contract type', 'Employment type', 'Contract'],
						language: ['Language', 'Languages'],
						placeOfWork: ['Place of work', 'Location', 'Place'],
						company: ['Company', 'Employer'],
					};

					const scannedPairs = scanPairs([
						...synonyms.publicationDate,
						...synonyms.workload,
						...synonyms.contractType,
						...synonyms.language,
						...synonyms.placeOfWork,
						...synonyms.company,
					]);

					function valueForLabelGroup(group) {
						return getBySynonyms(dlValues, scannedPairs, group);
					}

					function extractDescription() {
						// Try to gather structured sections under recognizable headings
						const root = document.querySelector('main') || document.querySelector('article') || document.body;
						const headings = Array.from(root.querySelectorAll('h2, h3'));
						const wanted = /(Introduction|About the job|Ihre Aufgaben|Aufgaben|Ihr Profil|Profil|Unser Angebot|Angebot|Responsibilities|Your tasks|Requirements|What we offer)/i;

						function collectUntilNextHeading(start) {
							const chunks = [];
							let node = start.nextElementSibling;
							while (node) {
								if (/^H2|H3$/.test(node.tagName)) break;
								// collect paragraphs and list items
								const ps = Array.from(node.querySelectorAll('p, li'));
								if (ps.length) {
									ps.forEach((el) => {
										const t = text(el);
										if (t) chunks.push(t);
									});
								} else {
									const t = text(node);
									if (t && t.split(/\s+/).length > 5) chunks.push(t);
								}
								node = node.nextElementSibling;
							}
							return chunks.join('\n');
						}

						const sections = [];
						for (const h of headings) {
							const ht = text(h);
							if (wanted.test(ht)) {
								const body = collectUntilNextHeading(h);
								if (body && body.length > 60) {
                                    sections.push(ht);
									sections.push(body);
								}
							}
						}
						if (sections.length) return sections.join('\n\n');

						// Fallback: longest paragraph/list block in main/article
						let best = '';
						(root.querySelectorAll('p, li') || []).forEach((el) => {
							const t = text(el);
							if (t.split(/\s+/).length > 20 && t.length > best.length) best = t;
						});
						return best;
					}

					const keyInfo = {
						publicationDate: valueForLabelGroup(synonyms.publicationDate),
						workload: valueForLabelGroup(synonyms.workload),
						contractType: valueForLabelGroup(synonyms.contractType),
						language: valueForLabelGroup(synonyms.language),
						placeOfWork: valueForLabelGroup(synonyms.placeOfWork),
					};

					// Title and company from detail header
					const titleEl = document.querySelector('main h1, h1');
					const title = titleEl ? text(titleEl) : '';
					let company = '';
					const companySelectors = [
						'main [data-testid="company-name"]',
						'main a[href*="/companies/"]',
						'main a[href*="/company/"]',
						'main a[rel="noopener"][target="_blank"]',
					];
					for (const sel of companySelectors) {
						const el = document.querySelector(sel);
						if (el) {
							const t = text(el);
							// Filter out navigation/common labels
							if (
								t &&
								t.length <= 160 &&
								!/^explore companies$/i.test(t) &&
								!/^find a job$/i.test(t) &&
								!/^salary estimator$/i.test(t) &&
								!/^recruiter area$/i.test(t) &&
								!/^login$/i.test(t)
							) {
								company = t;
								break;
							}
						}
					}
					if (!company) company = valueForLabelGroup(synonyms.company);

					const out = {
						title,
						company,
						description: extractDescription(),
						keyInfo,
					};

					// Sanitize keyInfo values
					const clean = (s) => (s || '').replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
					const stripPrefix = (val, label) =>
						clean(val).replace(new RegExp('^\\s*' + label.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\$&') + '\\s*:?\\s*', 'i'), '').trim();

					if (out.keyInfo) {
						if (out.keyInfo.publicationDate) {
							out.keyInfo.publicationDate = stripPrefix(out.keyInfo.publicationDate, 'Publication date');
						}
						if (out.keyInfo.workload) {
							out.keyInfo.workload = stripPrefix(out.keyInfo.workload, 'Workload');
						}
						if (out.keyInfo.contractType) {
							out.keyInfo.contractType = stripPrefix(out.keyInfo.contractType, 'Contract type');
						}
						if (out.keyInfo.language) {
							out.keyInfo.language = stripPrefix(out.keyInfo.language, 'Language');
						}
						if (out.keyInfo.placeOfWork) {
							out.keyInfo.placeOfWork = stripPrefix(out.keyInfo.placeOfWork, 'Place of work');
						}
					}

					return out;
				});

				job.description = detail.description;
				job.keyInfo = detail.keyInfo;
				// Override/normalize with detail page authoritative data
				if (detail.title) job.title = detail.title;
				if (detail.company) job.company = detail.company;
				if (detail.keyInfo?.placeOfWork) job.location = detail.keyInfo.placeOfWork;
				if (detail.keyInfo?.workload) job.workload = detail.keyInfo.workload;
				if (detail.keyInfo?.contractType) job.contractType = detail.keyInfo.contractType;

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

app.listen(PORT, '0.0.0.0', () => {
	console.log(`jobs-ch-scraper listening on port ${PORT} (0.0.0.0)`);
});



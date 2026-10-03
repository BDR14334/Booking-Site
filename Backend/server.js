// server.js
const express = require('express');
const path = require('path');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const coachRoutes = require('./routes/coach'); 
const adminRoutes = require('./routes/admin');
const athleteRoutes = require('./routes/athlete');
const bookingRoutes = require('./routes/booking');  
const timeslotRoutes = require('./routes/timeslot'); 
const contactRoutes = require('./routes/contact');
const { allowedOrigins } = require('./config');
const db = require('./db'); // Adjust path if needed


const app = express();
const PORT = process.env.PORT || 5000;
const normalizedAllowedOrigins = new Set(
  allowedOrigins.map(origin => origin.replace(/\/$/, '').toLowerCase())
);

app.set("trust proxy", 1);

// Only private/auth/admin/dashboard/backend routes should be hidden from crawlers.
// Public marketing pages (for example /, /about, /contact, /packages) must remain indexable.
const noIndexPathPrefixes = ['/auth', '/coach', '/athlete', '/admin', '/booking', '/timeslot'];
app.use((req, res, next) => {
  if (noIndexPathPrefixes.some(prefix => req.path.startsWith(prefix))) {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  }
  next();
});


// CORS config to allow credentials (cookies) from frontend
app.use(cors({
  origin: function (origin, callback) {
    if (!origin) {
      callback(null, true);
      return;
    }

    const normalizedOrigin = origin.replace(/\/$/, '').toLowerCase();
    if (normalizedAllowedOrigins.has(normalizedOrigin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true
}));

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

app.get('/sitemap.xml', async (req, res) => {
  try {
    const siteUrl = 'https://www.zephyrsstrengthandperformance.com';
    const publicUrls = [
      `${siteUrl}/`,
      `${siteUrl}/about`,
      `${siteUrl}/contact`,
      `${siteUrl}/packages`,
      `${siteUrl}/login`,
      `${siteUrl}/stories`
    ];
    const packages = await db.getPackages();
    const packageUrls = [...new Set(
      packages
        .map(packageDetails => packageDetails.slug)
        .filter(Boolean)
        .map(slug => `${siteUrl}/packages/${slug}`)
    )];
    const stories = await db.getStories();
    const storyUrls = [...new Set(
      stories
        .map(story => story.slug)
        .filter(Boolean)
        .map(slug => `${siteUrl}/stories/${slug}`)
    )];
    const urls = [...publicUrls, ...packageUrls, ...storyUrls];
    const urlEntries = urls
      .map(url => `  <url><loc>${escapeHtml(url)}</loc></url>`)
      .join('\n');

    res.type('application/xml').send(`<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urlEntries}
</urlset>`);
  } catch (err) {
    console.error('Error generating sitemap:', err);
    res.status(500).send('Error generating sitemap');
  }
});

// Serve static HTML + image assets
app.use(express.static(path.join(__dirname, '../Frontend')));
app.use('/img', express.static(path.join(__dirname, '../Frontend/img')));


// Mount routes
app.use('/auth', authRoutes.router);
app.use('/coach', coachRoutes); 
app.use('/athlete', athleteRoutes); 
app.use('/admin', adminRoutes);
app.use('/booking', bookingRoutes);
app.use('/timeslot', timeslotRoutes);
app.use('/contact', contactRoutes); 

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Simple visible summary styling that matches the dark page background.
const seoSectionStyle = '<style>.package-seo-content,.story-seo-content{box-sizing:border-box;width:100%;max-width:900px;margin:40px auto 0;padding:0 20px;color:#fff;text-align:left}.package-seo-content h2,.story-seo-content h2{font-size:24px;text-align:center;margin:0 0 16px}.package-seo-card,.story-seo-card{margin:0 0 24px;padding:16px 20px;border-radius:12px;background:rgba(255,255,255,0.06)}.package-seo-card h2,.story-seo-card h2{font-size:20px;text-align:left}.story-seo-card img{max-width:100%;height:auto;border-radius:8px}.package-seo-content a,.story-seo-content a{color:#ffa162}</style>';

app.get('/stories', async (req, res) => {
  try {
    const stories = await db.getStories();
    const storyCards = stories.filter(story => story.slug).map(story => {
      const rawImage = story.image_url || '/img/placeholder.png';
      return `
        <article class="story-seo-card">
          <h2>${escapeHtml(story.name)}</h2>
          <img src="${escapeHtml(rawImage)}" alt="${escapeHtml(story.name)} success story" width="300" loading="lazy" />
          <p>${escapeHtml(story.story)}</p>
          <p><a href="/stories/${encodeURIComponent(story.slug)}">Read ${escapeHtml(story.name)}'s story</a></p>
        </article>`;
    }).join('');
    const seoContent = `
    ${seoSectionStyle}
    <section class="story-seo-content" aria-label="Success story summaries">
      <h2>Athlete Success Story Summaries</h2>${storyCards}
    </section>
    `;

    const html = fs.readFileSync(path.join(__dirname, '../Frontend/stories.html'), 'utf8');
    const finalHtml = html
      .replace('<div class="title">Success Stories</div>', '<h1 class="title">Success Stories</h1>')
      .replace('</section>', () => `${seoContent}</section>`);

    res.type('html').send(finalHtml);
  } catch (err) {
    console.error('Error loading stories:', err);
    res.status(500).send('Error loading stories');
  }
});

app.get('/packages', async (req, res) => {
  try {
    // Fetch packages from your database
    const packages = await db.getPackages();

    // Build dynamic SEO meta tags and JSON-LD
    const packageNames = packages.map(pkg => pkg.title).filter(Boolean).join(', ');
    const packageDescriptions = packages.map(pkg => pkg.description).filter(Boolean).join(' | ');
    const packageStructuredData = {
      '@context': 'https://schema.org',
      '@type': 'ProductCatalog',
      name: 'Zephyrs Strength & Performance Packages',
      url: 'https://www.zephyrsstrengthandperformance.com/packages',
      description: packageDescriptions,
      brand: {
        '@type': 'SportsOrganization',
        name: 'Zephyrs Strength & Performance'
      },
      itemListElement: packages.map(pkg => ({
        '@type': 'Product',
        name: pkg.title,
        description: pkg.description,
        offers: {
          '@type': 'Offer',
          price: pkg.price,
          priceCurrency: 'USD'
        }
      }))
    };
    const seoPackageCards = packages.map(pkg => {
      const features = Array.isArray(pkg.features) ? pkg.features : [];
      const featureList = features.length
        ? `<ul>${features.map(feature => `<li>${escapeHtml(feature)}</li>`).join('')}</ul>`
        : '';
      const sessionText = pkg.sessions ? `<p><strong>Sessions:</strong> ${escapeHtml(pkg.sessions)}</p>` : '';
      const priceText = pkg.price !== null && pkg.price !== undefined
        ? `<p><strong>Price:</strong> $${escapeHtml(pkg.price)}</p>`
        : '';
      // Real crawlable link to the individual package page, present before any JS runs.
      const detailLink = pkg.slug
        ? `<p><a href="/packages/${encodeURIComponent(pkg.slug)}">View ${escapeHtml(pkg.title)} Details</a></p>`
        : '';

      return `
        <article class="package-seo-card">
          <h2>${escapeHtml(pkg.title)}</h2>
          <p>${escapeHtml(pkg.description)}</p>
          ${featureList}
          ${sessionText}
          ${priceText}
          ${detailLink}
        </article>`;
    }).join('');
    const seoPackageContent = `
      ${seoSectionStyle}
      <section class="package-seo-content" aria-label="Training package summaries">
        <h2>Training Package Summaries</h2>
        ${seoPackageCards || '<p>Contact us to learn about current training options.</p>'}
      </section>`;

    // Metadata (title, description, canonical, Open Graph) stays in the static packages.html.
    const seoHead = `
      <script type="application/ld+json">${JSON.stringify(packageStructuredData).replace(/</g, '\\u003c')}</script>
    `;

    // Read your static packages.html file
    const html = fs.readFileSync(path.join(__dirname, '../Frontend/packages.html'), 'utf8');

    const finalHtml = html
      .replace('</head>', () => `${seoHead}</head>`)
      .replace('<footer class="site-footer">', () => `<div style="background:#343a40;padding-bottom:20px">${seoPackageContent}</div>\n    <footer class="site-footer">`);

    res.send(finalHtml);
  } catch (err) {
    res.status(500).send('Error loading packages');
  }
});

app.get('/packages/:slug', async (req, res) => {
  try {
    const packageDetails = await db.getPackageBySlug(req.params.slug);
    if (!packageDetails) {
      return res.status(404).send('Package not found');
    }

    const features = Array.isArray(packageDetails.features) ? packageDetails.features : [];
    const featureList = features.length
      ? `<ul>${features.map(feature => `<li>${escapeHtml(feature)}</li>`).join('')}</ul>`
      : '';
    const sessionText = packageDetails.sessions
      ? `<p><strong>Sessions:</strong> ${escapeHtml(packageDetails.sessions)}</p>`
      : '';
    const placeholderDescriptions = new Set(['n/a', 'na', 'none', 'tbd']);
    const rawDescriptionText = typeof packageDetails.description === 'string'
      ? packageDetails.description.trim()
      : '';
    const descriptionText = placeholderDescriptions.has(rawDescriptionText.toLowerCase())
      ? ''
      : rawDescriptionText;
    const descriptionSection = descriptionText
      ? `<h3>Description:</h3><p>${escapeHtml(descriptionText)}</p>`
      : '';
    const packageUrl = `https://www.zephyrsstrengthandperformance.com/packages/${packageDetails.slug}`;
    const isLocal = req.hostname === 'localhost' || req.hostname === '127.0.0.1';
    const frontendBaseUrl = isLocal
      ? 'http://localhost:5500'
      : 'https://www.zephyrsstrengthandperformance.com';
    const packageStructuredData = {
      '@context': 'https://schema.org',
      '@type': 'Service',
      name: packageDetails.title,
      description: packageDetails.description,
      url: packageUrl,
      provider: {
        '@type': 'SportsOrganization',
        name: 'Zephyrs Strength & Performance',
        url: 'https://www.zephyrsstrengthandperformance.com/'
      }
    };

    res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(packageDetails.title)} | Zephyrs Strength &amp; Performance</title>
  <meta name="description" content="${escapeHtml(packageDetails.description)}" />
  <link rel="canonical" href="${escapeHtml(packageUrl)}" />
  <meta property="og:title" content="${escapeHtml(packageDetails.title)} | Zephyrs Strength &amp; Performance" />
  <meta property="og:description" content="${escapeHtml(packageDetails.description)}" />
  <meta property="og:url" content="${escapeHtml(packageUrl)}" />
  <meta property="og:image" content="https://www.zephyrsstrengthandperformance.com/img/ZSP-logo2.png" />
  <meta property="og:type" content="website" />
  <script type="application/ld+json">${JSON.stringify(packageStructuredData).replace(/</g, '\\u003c')}</script>
  <style>
    :root {
      color-scheme: dark;
      font-family: Arial, Helvetica, sans-serif;
    }

    body {
      margin: 0;
      min-height: 100vh;
      background: #343a40;
      color: #fff;
    }

    .package-detail-page {
      box-sizing: border-box;
      min-height: 100vh;
      padding: 48px 20px;
      display: flex;
      align-items: flex-start;
      justify-content: center;
    }

    .package-detail-page .booking {
      width: 100%;
      max-width: 900px;
      padding: 0;
      background: transparent;
    }

    .package-detail-page .box {
      width: 100%;
      max-width: 760px;
      margin: 0 auto;
      padding: 40px;
      box-sizing: border-box;
      background: #343a40;
      border-radius: 20px;
      box-shadow: 0 5px 15px #000;
    }

    .package-detail-page .icon {
      width: 140px;
      height: 140px;
      margin: 0 auto 28px;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #333;
      border-radius: 50%;
    }

    .package-detail-page .package-logo {
      display: block;
      width: 104px;
      max-width: 78%;
      height: auto;
      object-fit: contain;
      filter: brightness(0) invert(1);
    }

    .package-detail-page .topic {
      margin: 0 0 24px;
      color: #fff;
      font-size: clamp(26px, 5vw, 38px);
      line-height: 1.15;
      font-weight: 700;
      text-align: center;
    }

    .package-detail-page .box p,
    .package-detail-page .box ul {
      color: #fff;
      font-size: 17px;
      line-height: 1.65;
    }

    .package-detail-page .box ul {
      margin: 0 0 24px;
      padding-left: 24px;
    }

    .package-detail-page .box h3 {
      margin: 24px 0 8px;
      color: #fff;
      font-size: 18px;
    }

    .package-detail-page .package-detail-cta {
      display: inline-block;
      margin-top: 18px;
      padding: 12px 24px;
      border-radius: 10px;
      background: #ff4800;
      color: #fff;
      font-size: 16px;
      font-weight: 700;
      text-decoration: none;
    }

    .package-detail-page .package-detail-cta:hover,
    .package-detail-page .package-detail-cta:focus {
      background: #e03e00;
      color: #fff;
    }

    @media (max-width: 600px) {
      .package-detail-page {
        padding: 24px 14px;
      }

      .package-detail-page .box {
        padding: 28px 20px;
      }
    }
  </style>
</head>
<body>
  <main class="package-detail-page">
    <section class="booking">
      <article class="box package-detail-card">
        <div class="icon">
          <img
            src="/img/ZSP-logo2.png"
            alt="Zephyrs Strength &amp; Performance logo"
            class="package-logo"
          />
        </div>
        <h1 class="topic">${escapeHtml(packageDetails.title)}</h1>
        ${descriptionSection}
        <h3>Features:</h3>
        ${featureList}
        ${sessionText}
        <a class="package-detail-cta" href="${frontendBaseUrl}/packages?package=${encodeURIComponent(packageDetails.slug)}">Get Started</a>
      </article>
    </section>
  </main>
</body>
</html>`);
  } catch (err) {
    console.error('Error loading package by slug:', err);
    res.status(500).send('Error loading package');
  }
});

app.get('/stories/:slug', async (req, res) => {
  try {
    const story = await db.getStoryBySlug(req.params.slug);
    if (!story) {
      return res.status(404).send('Story not found');
    }

    const siteUrl = 'https://www.zephyrsstrengthandperformance.com';
    const storyUrl = `${siteUrl}/stories/${story.slug}`;
    const imageUrl = story.image_url && story.image_url.startsWith('http')
      ? story.image_url
      : `${siteUrl}${story.image_url || '/img/placeholder.png'}`;

    const storyText = typeof story.story === 'string' ? story.story.trim() : '';
    const metaDescription = storyText.length > 155
      ? `${storyText.slice(0, 155).replace(/\s+\S*$/, '')}...`
      : storyText;

    res.type('html').send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(story.name)} | Zephyrs Strength & Performance</title>
  <meta name="description" content="${escapeHtml(metaDescription)}" />
  <link rel="canonical" href="${escapeHtml(storyUrl)}" />
  <meta property="og:title" content="${escapeHtml(story.name)} | Zephyrs Strength & Performance" />
  <meta property="og:description" content="${escapeHtml(metaDescription)}" />
  <meta property="og:url" content="${escapeHtml(storyUrl)}" />
  <meta property="og:image" content="${escapeHtml(imageUrl)}" />
  <meta property="og:type" content="article" />
</head>
<body>
  <main>
    <article>
      <img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(story.name)} success story" style="max-width:100%;height:auto;" />
      <h1>${escapeHtml(story.name)}</h1>
      <p>${escapeHtml(storyText)}</p>
    </article>
  </main>
</body>
</html>`);
  } catch (err) {
    console.error('Error loading story by slug:', err);
    res.status(500).send('Error loading story');
  }
});

// Prevent API favicon confusion
app.get('/favicon.ico', (req, res) => res.status(204).end());
app.get('/favicon.png', (req, res) => res.status(204).end());

// Keep-alive endpoint for uptime monitors
app.get('/ping', async (req, res) => {
  try {
    await db.query('SELECT NOW()');
    res.status(200).send('pong-db-ok');
  } catch (err) {
    console.error('Ping DB check failed:', err.message);
    res.status(500).send('pong-db-fail');
  }
});



// Start the server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});


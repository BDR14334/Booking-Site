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
      `${siteUrl}/login`
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
        ? `<p><a href="https://www.zephyrsstrengthandperformance.com/packages/${escapeHtml(pkg.slug)}">View ${escapeHtml(pkg.title)} Details</a></p>`
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
      <section class="package-seo-content" aria-labelledby="packages-heading">
        <h1 id="packages-heading">Personalized Athletic Performance Training</h1>
        <p>Zephyrs Strength &amp; Performance offers personalized training packages focused on speed, strength, acceleration, and power for athletes training online or in person.</p>
        ${seoPackageCards || '<p>Contact us to learn about current training options.</p>'}
      </section>`;

    const seoHead = `
      <title>Packages | Zephyrs Strength & Performance</title>
      <meta name="description" content="${escapeHtml(`Training packages from Zephyrs Strength & Performance: ${packageNames}. ${packageDescriptions}`)}" />
      <link rel="canonical" href="https://www.zephyrsstrengthandperformance.com/packages" />
      <meta property="og:title" content="Packages | Zephyrs Strength & Performance" />
      <meta property="og:description" content="${escapeHtml(`Personalized athletic performance training packages: ${packageNames}.`)}" />
      <meta property="og:url" content="https://www.zephyrsstrengthandperformance.com/packages" />
      <script type="application/ld+json">${JSON.stringify(packageStructuredData).replace(/</g, '\\u003c')}</script>
    `;

    // Read your static packages.html file
    const html = fs.readFileSync(path.join(__dirname, '../Frontend/packages.html'), 'utf8');

    // Preserve the static page's styles and scripts while adding route-specific SEO tags.
    const finalHtml = html
      .replace('</head>', `${seoHead}</head>`)
      .replace('<div id="bookingFlow" class="booking-slider">', `${seoPackageContent}\n\n    <div id="bookingFlow" class="booking-slider">`);

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


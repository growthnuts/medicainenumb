const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const dir = '/Users/scottmcgovern/Downloads/medicainenumb';
const mime = { '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.xml': 'application/xml', '.txt': 'text/plain' };

// Local license database — add entries here for instant validation
// Format: { 'statename-licensenumber': { name: 'Provider Name', address: 'partial address' } }
const licenseDB = {};

// NPI Registry lookup (free, public, no API key needed)
function lookupNPI(name, state) {
  return new Promise((resolve, reject) => {
    const nameParts = name.trim().split(/\s+/);
    const last = encodeURIComponent(nameParts[nameParts.length - 1]);
    const first = nameParts.length > 1 ? encodeURIComponent(nameParts[0]) : '';
    const stateCode = getStateCode(state);
    let url = `https://npiregistry.cms.hhs.gov/api/?version=2.1&last_name=${last}&limit=5&enumeration_type=NPI-1`;
    if (first) url += `&first_name=${first}`;
    if (stateCode) url += `&state=${stateCode}`;

    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.result_count > 0) {
            const r = json.results[0];
            const basic = r.basic || {};
            const addr = (r.addresses && r.addresses[0]) || {};
            resolve({
              found: true,
              npi: r.number,
              name: (basic.first_name || '') + ' ' + (basic.last_name || ''),
              credential: basic.credential || '',
              state: addr.state || '',
              city: addr.city || ''
            });
          } else {
            resolve({ found: false });
          }
        } catch (e) { resolve({ found: false }); }
      });
    }).on('error', () => resolve({ found: false }));
  });
}

function getStateCode(stateName) {
  const states = { 'alabama':'AL','alaska':'AK','arizona':'AZ','arkansas':'AR','california':'CA','colorado':'CO','connecticut':'CT','delaware':'DE','florida':'FL','georgia':'GA','hawaii':'HI','idaho':'ID','illinois':'IL','indiana':'IN','iowa':'IA','kansas':'KS','kentucky':'KY','louisiana':'LA','maine':'ME','maryland':'MD','massachusetts':'MA','michigan':'MI','minnesota':'MN','mississippi':'MS','missouri':'MO','montana':'MT','nebraska':'NE','nevada':'NV','new hampshire':'NH','new jersey':'NJ','new mexico':'NM','new york':'NY','north carolina':'NC','north dakota':'ND','ohio':'OH','oklahoma':'OK','oregon':'OR','pennsylvania':'PA','rhode island':'RI','south carolina':'SC','south dakota':'SD','tennessee':'TN','texas':'TX','utah':'UT','vermont':'VT','virginia':'VA','washington':'WA','west virginia':'WV','wisconsin':'WI','wyoming':'WY' };
  return states[(stateName || '').toLowerCase()] || '';
}

http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];

  // License verification API
  if (url === '/api/verify-license' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { state, license, name, address } = JSON.parse(body);

        // Step 1: Check local database first
        const key = (state + '-' + license).toLowerCase();
        const record = licenseDB[key];
        if (record) {
          const nameMatch = record.name.toLowerCase() === name.toLowerCase();
          const addrMatch = record.address.toLowerCase().includes(address.toLowerCase().substring(0, 20));
          if (nameMatch && addrMatch) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ valid: true, message: 'License verified successfully.' }));
            return;
          }
        }

        // Step 2: Cross-reference with NPI Registry
        const npi = await lookupNPI(name, state);
        if (npi.found) {
          const stateCode = getStateCode(state);
          if (npi.state === stateCode) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              valid: true,
              message: `Provider verified via NPI Registry. NPI: ${npi.npi} — ${npi.name}${npi.credential ? ', ' + npi.credential : ''} (${npi.city}, ${npi.state}). Cleared to order.`
            }));
          } else {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              valid: false,
              message: `Provider found (NPI: ${npi.npi}) but registered in ${npi.state}, not ${stateCode}. Please verify your state or call (800) 555-1234.`
            }));
          }
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ valid: false, message: 'Provider not found in NPI Registry. Please check your name and state, or call (800) 555-1234 to verify manually.' }));
        }
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ valid: false, message: 'Invalid request.' }));
      }
    });
    return;
  }

  // Static file serving (supports clean URLs: /bronze -> /bronze.html)
  let filePath = url === '/' ? '/index.html' : url;
  let fp = path.join(dir, filePath);
  fs.readFile(fp, (err, data) => {
    if (err && !path.extname(filePath)) {
      // Try adding .html for clean URLs
      fp = path.join(dir, filePath + '.html');
      fs.readFile(fp, (err2, data2) => {
        if (err2) { res.writeHead(404); res.end('Not found'); return; }
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(data2);
      });
      return;
    }
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    const ext = path.extname(fp);
    res.writeHead(200, { 'Content-Type': mime[ext] || 'application/octet-stream' });
    res.end(data);
  });
}).listen(3000, () => console.log('Server running on port 3000'));

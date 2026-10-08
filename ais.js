// Vercel serverless function: live AIS position for one MMSI.
// No dependencies, no config files. Needs env var AISSTREAM_KEY (Node 22+, which Vercel uses by default).
module.exports = (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const mmsi = String((req.query && req.query.mmsi) || '').replace(/\D/g, '');
  if (mmsi.length !== 9) return res.status(400).json({ error: 'bad mmsi' });
  const key = process.env.AISSTREAM_KEY;
  if (!key) return res.status(200).json({ error: 'nokey' });
  if (typeof WebSocket === 'undefined') return res.status(200).json({ error: 'nows' });
  const pad = n => String(n).padStart(2, '0');
  const out = { mmsi };
  let done = false, soft = null, hard = null;
  const ws = new WebSocket('wss://stream.aisstream.io/v0/stream');
  const fin = () => {
    if (done) return; done = true; clearTimeout(hard); clearTimeout(soft);
    try { ws.close(); } catch (e) {}
    res.status(200).json(out);
  };
  hard = setTimeout(fin, 8000);
  ws.addEventListener('open', () => ws.send(JSON.stringify({
    APIKey: key, BoundingBoxes: [[[-90, -180], [90, 180]]],
    FiltersShipMMSI: [mmsi], FilterMessageTypes: ['PositionReport', 'ShipStaticData']
  })));
  ws.addEventListener('message', ev => {
    let m; try { m = JSON.parse(String(ev.data)); } catch (e) { return; }
    if (m.error) { out.error = String(m.error); return fin(); }
    const mm = m.MetaData || {}, msg = m.Message || {};
    if (mm.ShipName && mm.ShipName.trim()) out.name = mm.ShipName.trim();
    if (msg.PositionReport) {
      const p = msg.PositionReport;
      out.lat = p.Latitude; out.lon = p.Longitude; out.sog = p.Sog; out.cog = p.Cog;
      if (!soft) soft = setTimeout(fin, 1500);
    }
    if (msg.ShipStaticData) {
      const s = msg.ShipStaticData;
      if (s.Destination && s.Destination.trim()) out.dest = s.Destination.trim().replace(/@+/g, '');
      if (s.Eta && s.Eta.Month > 0) out.eta = pad(s.Eta.Day) + '/' + pad(s.Eta.Month) + ' ' + pad(s.Eta.Hour) + ':' + pad(s.Eta.Minute) + ' UTC';
      if (s.Name && s.Name.trim()) out.name = s.Name.trim();
    }
  });
  ws.addEventListener('error', () => { out.error = out.error || 'ws'; fin(); });
  ws.addEventListener('close', fin);
};

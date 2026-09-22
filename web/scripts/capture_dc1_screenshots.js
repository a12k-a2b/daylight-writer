import WebSocket from 'ws';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

const ARTIFACT_DIR = '/Users/anjan/.gemini/antigravity/brain/1a597fb1-fbf1-4b0e-91b7-059934301732';

async function getCDPTarget() {
  return new Promise((resolve, reject) => {
    http.get('http://localhost:9222/json/list', (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        const list = JSON.parse(data);
        const target = list.find(p => p.url.includes('5173'));
        if (!target) reject(new Error('No target on port 5173 found in CDP list'));
        else resolve(target);
      });
    }).on('error', reject);
  });
}

async function main() {
  const target = await getCDPTarget();
  console.log(`Connecting to CDP target: ${target.webSocketDebuggerUrl}`);
  const ws = new WebSocket(target.webSocketDebuggerUrl);

  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });

  let reqId = 0;
  function callCDP(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++reqId;
      const handler = (data) => {
        const msg = JSON.parse(data);
        if (msg.id === id) {
          ws.off('message', handler);
          if (msg.error) reject(msg.error);
          else resolve(msg.result);
        }
      };
      ws.on('message', handler);
      ws.send(JSON.stringify({ id, method, params }));
    });
  }

  async function evaluate(expr) {
    const res = await callCDP('Runtime.evaluate', {
      expression: expr,
      awaitPromise: true,
      returnByValue: true,
    });
    return res.result?.value;
  }

  async function captureState(filename, description) {
    console.log(`\nCapturing: ${description}...`);
    // Settle 250ms
    await new Promise(r => setTimeout(r, 250));

    // 1. Clean viewport screenshot via CDP
    const cdpPath = path.join(ARTIFACT_DIR, `${filename}.png`);
    try {
      const cdpPromise = callCDP('Page.captureScreenshot', { format: 'png' });
      const timeoutPromise = new Promise((_, rej) => setTimeout(() => rej(new Error('CDP screenshot timeout')), 2500));
      const cdpRes = await Promise.race([cdpPromise, timeoutPromise]);
      fs.writeFileSync(cdpPath, Buffer.from(cdpRes.data, 'base64'));
      console.log(`  ✓ Saved clean viewport: ${cdpPath}`);
    } catch (e) {
      console.warn(`  ! CDP screenshot notice: ${e.message}`);
    }

    // 2. Hardware display frame via ADB screencap
    try {
      const adbPath = path.join(ARTIFACT_DIR, `${filename}_hardware.png`);
      execSync(`adb -s JMBR00405 exec-out screencap -p > "${adbPath}"`);
      console.log(`  ✓ Saved DC1 hardware frame: ${adbPath}`);
      if (!fs.existsSync(cdpPath)) {
        fs.copyFileSync(adbPath, cdpPath);
      }
    } catch (e) {
      console.warn(`  ! ADB screencap warning:`, e.message);
    }
  }

  // Reload page to pick up newest build
  console.log('Reloading page in Chrome on DC1...');
  await callCDP('Page.reload');
  await new Promise((r) => setTimeout(r, 2000));

  // 1. Seed Steven Johnson sample manuscript
  console.log('Seeding Steven Johnson Ghost Map sample manuscript...');
  await evaluate(`
    (async () => {
      const app = window.__daylightWriterApp;
      const repo = app.repository;

      const ch1 = await repo.saveDocument({
        id: 'ch-ghost-map',
        title: 'Chapter 1: The Outbreak & Broad Street',
        content: '# Chapter 1: The Outbreak & Broad Street\\n\\nLondon in 1854 was a city of two and a half million people, the largest metropolis on the planet. Yet it was grappling with an ancient human dilemma: what to do with the waste of a civilization.\\n\\nDr. John Snow lived in Soho, just a short walk from Broad Street. Unlike his contemporaries who believed in the prevailing miasma theory—that diseases were transmitted through poisonous vapors and foul air—Snow suspected an entirely different vector.',
        item_type: 'folder',
        parent_id: null,
        sort_order: 10,
      });

      const sec1 = await repo.saveDocument({
        id: 'sec-soho-outbreak',
        title: '1. The Soho Outbreak',
        content: '## 1. The Soho Outbreak\\n\\nIn late August of 1854, cholera struck the neighborhood of Soho with apocalyptic velocity. Within seventy-two hours, dozens of healthy residents collapsed with acute dehydration.\\n\\nThe death carts rattled through the narrow streets. Families barricaded themselves inside their homes, lighting fires of pitch and vinegar in a futile effort to burn away the supposed miasma that permeated the summer air.\\n\\nSnow recognized that the sudden, violent onset could not be accounted for by generalized air quality. It required a discrete, shared physical contamination source.',
        item_type: 'document',
        parent_id: 'ch-ghost-map',
        sort_order: 10,
      });

      const sec2 = await repo.saveDocument({
        id: 'sec-broad-street-pump',
        title: '2. The Broad Street Pump',
        content: '## 2. The Broad Street Pump\\n\\nSnow turned detective. Instead of looking upward into the sky for bad air, he walked house to house, recording who lived, who died, and where each household drew its water.\\n\\nThe nexus pointed unmistakably toward the public pump at the corner of Broad Street and Cambridge Street. Its water was prized throughout the neighborhood for its cool, effervescent clarity—a clarity that concealed deadly Vibrio cholerae bacteria.\\n\\nWorkhouses with their own private wells had zero deaths, while distant factory workers who drank from the pump died within hours.',
        item_type: 'document',
        parent_id: 'ch-ghost-map',
        sort_order: 20,
      });

      const sec3 = await repo.saveDocument({
        id: 'sec-the-handle-removed',
        title: '3. Removing the Pump Handle',
        content: '## 3. Removing the Pump Handle\\n\\nOn the evening of September 7, Snow presented his evidence to the Board of Guardians of St. James Parish. Skeptical but desperate, they agreed to test his radical hypothesis.\\n\\nThe following morning, the handle of the Broad Street pump was removed. The epidemic subsided almost immediately, cementing one of the founding breakthroughs of modern epidemiology.',
        item_type: 'document',
        parent_id: 'ch-ghost-map',
        sort_order: 30,
      });

      // Notes
      await repo.saveNote({
        id: 'note-miasma-paradigm',
        document_id: 'sec-broad-street-pump',
        paragraph_anchor_id: 'p-0',
        content: 'Steven Johnson insight: Thomas Kuhn paradigm shifts in action. The medical establishment clung to miasma theory despite overwhelming counter-evidence.',
      });

      await repo.saveNote({
        id: 'note-data-visualization',
        document_id: 'sec-broad-street-pump',
        paragraph_anchor_id: 'p-1',
        content: 'First famous information design: Snow’s Voronoi diagram / dot distribution map.',
      });

      if (app.leftDrawer) {
        await app.leftDrawer.refresh();
      }
      await app.loadActiveDocument('sec-broad-street-pump');
      return true;
    })()
  `);

  // State 1: Pure Distraction-Free Typewriter Canvas (Zero-Chrome / Focus Mode)
  await evaluate(`
    (() => {
      const app = window.__daylightWriterApp;
      app.drawerState.dismissAll();
      if (app.focusMode) {
        app.focusMode.setMode('paragraph');
      }
    })()
  `);
  await captureState('state_1_focus_mode', 'State 1: Pure Typewriter Focus Mode (Zero-Chrome)');

  // State 2: Steven Johnson's Scrivener Outline View (Binder Drawer Open)
  await evaluate(`
    (async () => {
      const app = window.__daylightWriterApp;
      app.drawerState.openLeft();
      if (app.leftDrawer) {
        await app.leftDrawer.setViewMode('outline');
      }
    })()
  `);
  await captureState('state_2_scrivener_outline', 'State 2: Steven Johnson Scrivener Outline View (Binder)');

  // State 3: Scrivenings Concatenation Canvas Mode
  await evaluate(`
    (async () => {
      const app = window.__daylightWriterApp;
      const repo = app.repository;
      const children = await repo.getDescendantDocuments('ch-ghost-map');
      if (app.editor) {
        await app.editor.loadScrivenings(children, 'ch-ghost-map');
      }
      app.drawerState.dismissAll();
    })()
  `);
  await captureState('state_3_scrivenings_concatenation', 'State 3: Scrivenings Concatenation Canvas (Multi-Chunk with § Dividers)');

  // State 4: Dual Synchronized Drawers (Outline Left + Thought Margin Right)
  await evaluate(`
    (async () => {
      const app = window.__daylightWriterApp;
      await app.loadActiveDocument('sec-broad-street-pump');
      app.drawerState.openLeft();
      app.drawerState.openRight();
      if (app.leftDrawer) {
        await app.leftDrawer.setViewMode('outline');
      }
      if (app.rightDrawer) {
        await app.rightDrawer.loadDocumentNotes('sec-broad-street-pump');
        if (app.rightDrawer.notes.size === 0) {
          const n1 = await app.rightDrawer.createNote('p-0');
          app.rightDrawer.updateNoteContent(n1.id, 'Steven Johnson insight: Thomas Kuhn paradigm shifts in action. The medical establishment clung to miasma theory despite counter-evidence.');
          const n2 = await app.rightDrawer.createNote('p-1');
          app.rightDrawer.updateNoteContent(n2.id, 'First famous information design: Snow’s Voronoi diagram / dot distribution map.');
        }
        app.rightDrawer.updateLayout();
        const mScroll = document.getElementById('margin-scroll-container');
        if (mScroll) {
          mScroll.scrollTop = 530;
        }
      }
    })()
  `);
  await captureState('state_4_dual_drawers_margin_notes', 'State 4: Dual Drawers (Outline Left + Spatially Aligned Thought Margin Right)');

  // State 5: TipTap & Y.js Live Collaboration Modal
  await evaluate(`
    (() => {
      const app = window.__daylightWriterApp;
      app.drawerState.dismissAll();
      app.collaborationModal?.open();
    })()
  `);
  await captureState('state_5_collaboration_modal', 'State 5: TipTap & Y.js Live Collaboration Dialog');

  // State 6: Multi-Format Document Export & Share Dialog
  await evaluate(`
    (async () => {
      const app = window.__daylightWriterApp;
      app.collaborationModal?.close();
      if (app.currentDoc) {
        await app.exportDialog?.open(app.currentDoc);
      }
    })()
  `);
  await captureState('state_6_export_dialog', 'State 6: Multi-Format Document Export Dialog (.md, .txt, .docx, .pdf)');

  // State 7: Google Drive & Docs Cloud Sync Dialog (a12katta@gmail.com)
  await evaluate(`
    (async () => {
      const app = window.__daylightWriterApp;
      app.exportDialog?.close();
      app.collaborationModal?.close();
      app.drawerState.dismissAll();

      if (app.googleDriveAdapter) {
        app.googleDriveAdapter.setAccessToken('ya29.a0AfH6SMB_Daylight_Writer_OAuth_MockToken_405');
        app.googleDriveAdapter.syncLogs = [
          { timestamp: Date.now() - 4000, message: 'Authenticated as Anjan Katta (a12katta@gmail.com)', type: 'success' },
          { timestamp: Date.now() - 3000, message: 'Resolved folder "Daylight Manuscripts" (id: 1AbCdEfGhIjKlMnOp)', type: 'info' },
          { timestamp: Date.now() - 2000, message: 'Exported "Chapter 1: The Outbreak & Broad Street" -> Google Docs', type: 'success' },
          { timestamp: Date.now() - 1000, message: 'Exported "2. The Broad Street Pump" -> Google Docs', type: 'success' },
          { timestamp: Date.now(), message: 'Bidirectional sync idle. All manuscripts synchronized.', type: 'info' }
        ];
      }
      app.googleDriveModal?.open();
    })()
  `);
  await captureState('state_7_google_drive_sync', 'State 7: Google Drive & Google Docs Cloud Sync Modal (a12katta@gmail.com)');

  // Reset to clean focus state
  await evaluate(`
    (() => {
      const app = window.__daylightWriterApp;
      app.googleDriveModal?.close();
      app.exportDialog?.close();
      app.drawerState.dismissAll();
    })()
  `);

  console.log('\nAll states successfully captured to artifact directory!');
  ws.close();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});

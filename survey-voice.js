(function () {
  "use strict";

  // Rilievo vocale facoltativo: nessuna registrazione audio e nessun salvataggio automatico.
  let currentRecognizer = null;
  let activeButton = null;

  function normalized(text) {
    return String(text || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .toLowerCase().replace(/\s+/g, " ").trim();
  }

  function parse(text) {
    const s = normalized(text);
    const fields = {};
    const warnings = [];
    const notes = [];
    if (!s) return { fields, warnings: ["Detta o inserisci una descrizione del serramento."], notes };

    const rooms = ["camera matrimoniale", "camera da letto", "camera", "cameretta",
      "soggiorno", "salone", "sala", "cucina", "bagno", "mansarda", "cantina",
      "taverna", "ingresso", "studio", "veranda", "lavanderia", "garage", "corridoio", "ripostiglio"];
    const room = rooms.find(word => new RegExp("\\b" + word + "\\b").test(s));
    if (room) fields.room = room.charAt(0).toUpperCase() + room.slice(1);

    const isTwo = /\b(?:due|2)\s+ante\b/.test(s);
    const isOne = /\b(?:una|un|1)\s+(?:sola?\s+)?anta\b/.test(s) || /\bmono\s*anta\b/.test(s);
    if (/\bporta\s?finestra\b/.test(s)) {
      if (isTwo || isOne) fields.opening_type = "Portafinestra " + (isTwo ? "2" : "1") + " ante".replace("1 ante", "1 anta");
    } else if (/\bfinestra\b/.test(s)) {
      if (isTwo || isOne) fields.opening_type = "Finestra " + (isTwo ? "2 ante" : "1 anta");
    } else if (/\bportoncino\b/.test(s)) fields.opening_type = "Portoncino";
    else if (/\bscorrevole\b/.test(s) && !/\bzanzariera\b/.test(s)) fields.opening_type = "Scorrevole";
    else if (/\bfisso\b/.test(s)) fields.opening_type = "Fisso";

    const qty = s.match(/\b(?:quantita|qta|numero(?:\s+di)?\s+pezzi)\s*(?:di\s*)?(\d{1,2})\b/) ||
      s.match(/\b(\d{1,2})\s+(?:pezzi|serramenti|finestre|portefinestre)\b/);
    if (qty && Number(qty[1]) > 0) fields.quantity = String(Number(qty[1]));

    function millimetres(rawValue, unit, fieldLabel) {
      const value = Number(String(rawValue).replace(",", "."));
      if (!Number.isFinite(value) || value <= 0) return null;
      const u = String(unit || "").toLowerCase();
      if (/^cm|^centim/.test(u)) return Math.round(value * 10);
      if (/^mm|^millim/.test(u)) return Math.round(value);
      if (value >= 450) {
        warnings.push(fieldLabel + ": unità non detta, interpretati millimetri. Controlla.");
        return Math.round(value);
      }
      warnings.push(fieldLabel + ": specifica cm o mm; valore non inserito per sicurezza.");
      return null;
    }

    const unit = "(mm|millimetri|millimetro|cm|centimetri|centimetro)?";
    const widthRe = new RegExp("\\b(?:larghezza|larga|largo)\\s*(?:di\\s*)?(\\d{2,4}(?:[,.]\\d+)?)\\s*" + unit, "g");
    const heightRe = new RegExp("\\b(?:altezza|alta|alto)\\s*(?:di\\s*)?(\\d{2,4}(?:[,.]\\d+)?)\\s*" + unit, "g");
    const widths = [...s.matchAll(widthRe)];
    const heights = [...s.matchAll(heightRe)].filter(m => !/\b(?:anta|ante|sopraluce)\s*$/.test(s.slice(Math.max(0, m.index - 24), m.index)));
    const pair = s.match(/\b(\d{2,4}(?:[,.]\d+)?)\s*(?:x|per)\s*(\d{2,4}(?:[,.]\d+)?)\s*(mm|millimetri|cm|centimetri)?\b/);
    if (pair) {
      const w = millimetres(pair[1], pair[3], "Larghezza");
      const h = millimetres(pair[2], pair[3], "Altezza");
      if (w) fields.width_mm = String(w);
      if (h) fields.height_mm = String(h);
    }
    if (widths.length) {
      const m = widths[0], w = millimetres(m[1], m[2], "Larghezza");
      if (w) fields.width_mm = String(w);
    }
    if (heights.length) {
      const m = heights[0], h = millimetres(m[1], m[2], "Altezza");
      if (h) fields.height_mm = String(h);
    }

    const pvc = s.match(/\bpvc\s*(72|76|80|82)\b/);
    if (pvc) fields.profile = "PVC " + pvc[1];
    else if (/\blegno\s*\/\s*alluminio\b|\blegno alluminio\b/.test(s)) fields.profile = "Legno/Alluminio";
    else if (/\balluminio\b/.test(s) && !/\btapparella\b/.test(s)) fields.profile = "Alluminio";
    else if (/\bprofilo\s+in\s+legno\b/.test(s)) fields.profile = "Legno";

    const colors = "(?:ral\\s*\\d{4}|rovere miele|rovere|grigio antracite|grigio chiaro|bianco opaco|bianco|bianca|noce|nero|nera|antracite|avorio|grigio|marrone|verde muschio|verde)";
    function extractSide(side) {
      const re = new RegExp("(?:colore\\s+)?(?:" + side + ")\\s*(?:colore\\s*)?(?:di\\s*)?(" + colors + ")\\b");
      const m = s.match(re);
      return m ? m[1].replace(/\bral\s*(\d{4})/, "RAL $1") : "";
    }
    const inside = extractSide("interno|interna");
    const outside = extractSide("esterno|esterna");
    let color = "";
    if (inside || outside) color = [inside ? "Interno: " + inside : "", outside ? "Esterno: " + outside : ""].filter(Boolean).join(" / ");
    else {
      const generic = s.match(new RegExp("\\b(?:colore|finitura)\\s*(?:di\\s*)?(" + colors + ")\\b"));
      if (generic) color = generic[1].replace(/\bral\s*(\d{4})/, "RAL $1");
      else if (/\b(?:tutto|tutta|tutti)\s+bianc[oaie]\b/.test(s)) color = "Bianco";
    }
    if (color) {
      fields.position_color = color;
      fields.frame_color = color;
    }

    if (/\btriplo vetro\b|\bvetro triplo\b/.test(s)) fields.glass_spec = "Triplo vetro";
    else if (/\bdoppio vetro\b|\bvetro doppio\b/.test(s)) fields.glass_spec = "Doppio vetro";
    else if (/\bvetro satinato\b/.test(s)) fields.glass_spec = "Vetro satinato";
    else if (/\bvetro (?:di )?sicurezza\b/.test(s)) fields.glass_spec = "Vetro di sicurezza";
    else if (/\bvetro (?:antirumore|acustico)\b/.test(s)) fields.glass_spec = "Vetro acustico";

    const handle = s.match(/\bmaniglia\s+(?:colore\s+)?(bianca|bianco|nera|nero|satinata|satinato|argento|bronzo)\b/);
    if (handle) fields.handle_color = handle[1];

    if (/\bzanzariera\b/.test(s)) {
      if (/\bplissettat[ao]\b/.test(s)) fields.mosquito_net = "Plissettata";
      else if (/\b(?:a rullo|rullo)\b/.test(s)) fields.mosquito_net = "Rullo";
      else if (/\bscorrevole\b/.test(s)) fields.mosquito_net = "Scorrevole";
      else warnings.push("Zanzariera citata senza modello: completa manualmente.");
    }
    if (/\btapparella\b/.test(s)) {
      if (/\balluminio coibentato\b/.test(s)) fields.roller_shutter = "Alluminio coibentato";
      else if (/\btapparella\s+(?:in\s+)?pvc\b/.test(s)) fields.roller_shutter = "PVC";
      if (/\bmotorizzat[ao]\b/.test(s)) fields.roller_shutter_control = /\btelecomando\b/.test(s) ? "Motorizzata + telecomando" : "Motorizzata";
      else if (/\bmanuale\b|\bcinghia\b/.test(s)) fields.roller_shutter_control = "Manuale cinghia";
      const shutterColor = s.match(new RegExp("\\btapparella\\s+(?:colore\\s+)?(" + colors + ")\\b"));
      if (shutterColor) fields.roller_shutter_color = shutterColor[1];
    }
    if (/\bpersiana\b/.test(s)) {
      const persianaColor = s.match(new RegExp("\\bpersiana\\s+(?:colore\\s+)?(" + colors + ")\\b"));
      fields.persiana = "Persiana" + (persianaColor ? " " + persianaColor[1] : "");
    }
    if (/\bcassonetto\b/.test(s)) {
      if (/\bcassonetto (?:esistente|da mantenere)\b/.test(s)) fields.cassonetto = "Esistente";
      else if (/\bcassonetto (?:nuovo|da sostituire)\b/.test(s)) fields.cassonetto = "Nuovo";
    }

    const wall = s.match(/\b(?:spessore (?:del )?muro|muro spesso)\s*(?:di\s*)?(\d{2,4})\s*(mm|millimetri|cm|centimetri)?/);
    if (wall) {
      const val = millimetres(wall[1], wall[2], "Spessore muro");
      if (val) fields.wall_thickness_mm = String(val);
    }
    if (/\brimozione totale\b/.test(s)) fields.installation_type = "Rimozione totale";
    else if (/\bposa su controtelaio\b/.test(s)) fields.installation_type = "Posa su controtelaio";
    else if (/\bsostituzione su telaio esistente\b/.test(s)) fields.installation_type = "Sostituzione su telaio esistente";

    const direction = s.match(/\b(spingere|tirare)\s+(destra|sinistra|dx|sx)\b/) ||
      s.match(/\b(?:apertura|apre)\s+(?:a\s+)?(destra|sinistra|dx|sx)\b/);
    if (direction) {
      const right = /^(?:destra|dx)$/.test(direction[direction.length - 1]);
      fields.opening_direction = direction.length === 3
        ? (direction[1] === "spingere" ? "Spingere " : "Tirare ") + (right ? "DX" : "SX")
        : (right ? "DX" : "SX");
    }

    if (/\bsopraluce\b/.test(s)) {
      const sash = s.match(/\b(?:anta|ante)\s*(?:altezza|alta|alte|alto|da|di)\s*(?:di\s*)?(\d{2,4})\s*(mm|millimetri|cm|centimetri)?/);
      const over = s.match(/\bsopraluce\s*(?:alto|alta|altezza|di)\s*(?:di\s*)?(\d{2,4})\s*(mm|millimetri|cm|centimetri)?/);
      if (sash) {
        const sashMm = millimetres(sash[1], sash[2], "Altezza anta");
        if (sashMm) {
          notes.push("Altezza anta: " + sashMm + " mm");
          if (fields.height_mm && Number(fields.height_mm) > sashMm) {
            notes.push("Sopraluce: " + (Number(fields.height_mm) - sashMm) + " mm (calcolato, da verificare)");
          }
        }
      } else if (over) {
        const overMm = millimetres(over[1], over[2], "Altezza sopraluce");
        if (overMm) notes.push("Sopraluce: " + overMm + " mm");
      } else notes.push("Sopraluce presente: dimensioni da verificare");
    }
    const spokenNote = s.match(/\b(?:nota|note tecniche|attenzione)\s*[:\-]\s*(.+)$/);
    if (spokenNote) notes.push(spokenNote[1].trim());

    if (!Object.keys(fields).length && !notes.length) {
      warnings.push("Nessun campo riconosciuto. Prova con: cucina, 1395 per 2700 millimetri, PVC 80, colore interno bianco, esterno noce.");
    }
    return { fields, warnings: [...new Set(warnings)], notes: [...new Set(notes)] };
  }

  function stop() {
    if (!currentRecognizer) return;
    const rec = currentRecognizer;
    currentRecognizer = null;
    try { rec.abort(); } catch (_) {}
    if (activeButton) activeButton.disabled = false;
    activeButton = null;
  }

  function addStyles() {
    if (document.getElementById("edoglo-voice-styles")) return;
    const style = document.createElement("style");
    style.id = "edoglo-voice-styles";
    style.textContent = ".edoglo-voice{background:#eff6ff;border:1px solid #bfdbfe;border-radius:16px;padding:14px;margin:12px 0 18px}.edoglo-voice h3{margin:0;font-size:16px;color:#1e3a8a}.edoglo-voice p{font-size:13px;line-height:1.5;color:#334155;margin:7px 0}.edoglo-voice textarea{display:block;width:100%;min-height:100px;padding:12px;border:1px solid #93c5fd;border-radius:12px;background:#fff;color:#0f172a;margin:12px 0;resize:vertical}.edoglo-voice-actions{display:flex;flex-wrap:wrap;gap:8px}.edoglo-voice-actions button{min-height:44px}.edoglo-voice-preview{margin-top:11px;display:grid;gap:5px}.edoglo-voice-preview div{background:#fff;border:1px solid #dbeafe;padding:7px 10px;border-radius:8px;font-size:12px;color:#0f172a}.edoglo-voice-status{min-height:18px;font-size:12px;margin:8px 0}.edoglo-voice .edoglo-voice-warning{background:#fff7ed;border-color:#fed7aa;color:#9a3412}.edoglo-voice-help{font-size:12px;color:#475569}.edoglo-voice button:disabled{opacity:.55;cursor:not-allowed}";
    document.head.appendChild(style);
  }

  function mount(form) {
    stop();
    if (!form || form.querySelector(".edoglo-voice")) return;
    addStyles();
    const panel = document.createElement("section");
    panel.className = "edoglo-voice";
    panel.setAttribute("aria-label", "Rilievo vocale facoltativo");
    panel.innerHTML =
      '<h3>🎙 Rilievo vocale · prova</h3>' +
      '<p>Puoi dettare le misure oppure usare il microfono della tastiera. Controlla l’anteprima, premi <b>Applica alla scheda</b> e salva con il pulsante normale. La compilazione manuale resta sempre disponibile.</p>' +
      '<div class="edoglo-voice-actions">' +
        '<button type="button" class="btn primary" data-voice-start>Avvia microfono</button>' +
        '<button type="button" class="btn ghost" data-voice-stop disabled>Ferma</button>' +
        '<button type="button" class="btn ghost" data-voice-check>Analizza testo</button>' +
      '</div>' +
      '<textarea data-voice-text aria-label="Testo dettato per il rilievo" placeholder="Es. Cucina, portafinestra due ante, 1395 per 2700 millimetri, PVC 80, interno bianco, esterno noce, anta alta 2100 e sopraluce."></textarea>' +
      '<div class="edoglo-voice-status" data-voice-status role="status">Il sistema propone i dati, non salva automaticamente.</div>' +
      '<div class="edoglo-voice-preview" data-voice-preview aria-live="polite"></div>' +
      '<div class="edoglo-voice-actions" style="margin-top:12px"><button type="button" class="btn primary" data-voice-apply disabled>Applica alla scheda (non salva)</button></div>' +
      '<p class="edoglo-voice-help">Se il browser non supporta il microfono, usa quello della tastiera o prosegui manualmente. Non dettare nomi o informazioni personali: il browser può inviare l’audio al proprio servizio di riconoscimento. Nessun audio viene salvato dal CRM.</p>';
    const header = form.querySelector(".position-head");
    if (header) header.insertAdjacentElement("afterend", panel);
    else form.prepend(panel);
    const textarea = panel.querySelector("[data-voice-text]");
    const start = panel.querySelector("[data-voice-start]");
    const stopButton = panel.querySelector("[data-voice-stop]");
    const applyButton = panel.querySelector("[data-voice-apply]");
    const preview = panel.querySelector("[data-voice-preview]");
    const status = panel.querySelector("[data-voice-status]");
    const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    let parsed = parse("");

    function display() {
      parsed = parse(textarea.value);
      preview.replaceChildren();
      const labels = {
        room:"Ambiente", opening_type:"Tipologia", quantity:"Quantità",
        width_mm:"Larghezza (mm)", height_mm:"Altezza (mm)",
        profile:"Profilo", position_color:"Colore / finitura", frame_color:"Colore serramento",
        glass_spec:"Vetro", handle_color:"Maniglia", mosquito_net:"Zanzariera",
        roller_shutter:"Tapparella", roller_shutter_control:"Comando tapparella",
        roller_shutter_color:"Colore tapparella", persiana:"Persiana", cassonetto:"Cassonetto",
        wall_thickness_mm:"Spessore muro", installation_type:"Tipo posa",
        opening_direction:"Apertura"
      };
      Object.entries(parsed.fields).forEach(([key,value]) => {
        const line = document.createElement("div");
        const present = Boolean(form.querySelector('[name="' + key + '"]'));
        line.textContent = (labels[key] || key) + ": " + value + (present ? "" : " (nelle note, se pertinente)");
        preview.appendChild(line);
      });
      if (parsed.notes.length) {
        const line = document.createElement("div");
        line.textContent = "Note: " + parsed.notes.join("; ");
        preview.appendChild(line);
      }
      parsed.warnings.forEach(w => {
        const line = document.createElement("div");
        line.className = "edoglo-voice-warning";
        line.textContent = "Attenzione: " + w;
        preview.appendChild(line);
      });
      applyButton.disabled = !Object.keys(parsed.fields).length && !parsed.notes.length;
    }

    function apply() {
      display();
      const updates = Object.entries(parsed.fields).map(([key, value]) => ({
        key, value, field: form.querySelector('[name="' + key + '"]')
      }));
      const overwrites = updates.filter(x => x.field && x.field.value && x.field.value !== x.value);
      if (overwrites.length && !window.confirm("Alcuni campi già compilati saranno sostituiti dai dati dettati. Continuare?")) return;
      const extra = [];
      updates.forEach(({key,value,field}) => {
        if (!field) {
          if (!["opening_type","profile","frame_color"].includes(key)) extra.push(key + ": " + value);
          return;
        }
        if (field.tagName === "SELECT" && !Array.from(field.options).some(o => o.value === value)) {
          extra.push(key + ": " + value);
          return;
        }
        field.value = value;
        field.dispatchEvent(new Event("input", { bubbles:true }));
        field.dispatchEvent(new Event("change", { bubbles:true }));
      });
      if (parsed.fields.position_color) form.dataset.voiceColor = parsed.fields.position_color;
      const noteField = form.querySelector('[name="notes"]');
      if (noteField) {
        const additions = parsed.notes.concat(extra.map(t => "Da verificare - " + t));
        additions.forEach(t => {
          if (!noteField.value.includes(t)) noteField.value = [noteField.value.trim(),t].filter(Boolean).join("\n");
        });
      }
      status.textContent = "Dati applicati ai campi. Verifica tutte le misure e premi «Salva posizione» per registrarli.";
    }

    panel.querySelector("[data-voice-check]").onclick = display;
    textarea.addEventListener("input", display);
    applyButton.onclick = apply;
    if (!Recognition || !window.isSecureContext) {
      start.disabled = true;
      status.textContent = "Riconoscimento del browser non disponibile. Usa la dettatura della tastiera o i campi manuali.";
    }
    start.onclick = () => {
      if (!Recognition || currentRecognizer) return;
      let rec;
      try {
        rec = new Recognition();
        rec.lang = "it-IT";
        rec.continuous = true;
        rec.interimResults = false;
        rec.maxAlternatives = 1;
        rec.onresult = event => {
          if (!form.isConnected) return;
          const words = [];
          for (let i = event.resultIndex; i < event.results.length; i++) {
            if (event.results[i].isFinal) words.push(event.results[i][0].transcript);
          }
          if (words.length) {
            textarea.value = [textarea.value.trim(), words.join(" ")].filter(Boolean).join("\n");
            display();
          }
        };
        rec.onerror = event => {
          const errors = {
            "not-allowed":"Microfono non autorizzato. Puoi continuare manualmente.",
            "service-not-allowed":"Servizio vocale bloccato dal browser.",
            "network":"Rete non disponibile per il riconoscimento vocale.",
            "no-speech":"Non ho rilevato parole. Riprova o usa la tastiera.",
            "audio-capture":"Microfono non disponibile. Usa i campi manuali."
          };
          status.textContent = errors[event.error] || "Dettatura interrotta: " + (event.error || "errore") + ". Il modulo manuale resta disponibile.";
        };
        rec.onend = () => {
          if (currentRecognizer === rec) currentRecognizer = null;
          if (activeButton === start) activeButton = null;
          start.disabled = false;
          stopButton.disabled = true;
        };
        rec.start();
        currentRecognizer = rec;
        activeButton = start;
        start.disabled = true;
        stopButton.disabled = false;
        status.textContent = "Sto ascoltando: descrivi una posizione alla volta. Ferma quando hai finito.";
      } catch (_) {
        currentRecognizer = null;
        activeButton = null;
        start.disabled = true;
        stopButton.disabled = true;
        status.textContent = "Impossibile avviare il microfono qui. Usa la dettatura della tastiera o la compilazione manuale.";
      }
    };
    stopButton.onclick = () => {
      if (currentRecognizer) {
        const rec = currentRecognizer;
        currentRecognizer = null;
        try { rec.stop(); } catch (_) {}
      }
      start.disabled = false;
      stopButton.disabled = true;
      status.textContent = "Dettatura fermata. Controlla l'anteprima e applica i dati alla scheda.";
    };
    form.addEventListener("submit", stop, { once:true });
    display();
  }

  window.EdogloVoice = { mount, stop, parse };
})();

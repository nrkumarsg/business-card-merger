import React, { useState, useEffect, useRef } from "react";
import {
  Columns,
  Grid,
  Trash2,
  Save,
  Sparkles,
  ArrowRight,
  Maximize2,
  RefreshCw,
  Sliders,
  CheckCircle,
  AlertTriangle,
  Contact,
  Users,
} from "lucide-react";
import { CardPair, ParsedCard, DriveFile } from "../types";

interface CardMergerProps {
  token: string;
  pairs: CardPair[];
  mergedFolderId: string;
  onUpdatePair: (updated: CardPair) => void;
  onRemovePair: (id: string) => void;
  onClearAll: () => void;
  onAddContactToSaved: (contact: ParsedCard, cardId: string) => void;
  rawFiles: DriveFile[];
  onUpdateRawFiles: (files: DriveFile[]) => void;
}

export default function CardMerger({
  token,
  pairs,
  mergedFolderId,
  onUpdatePair,
  onRemovePair,
  onClearAll,
  onAddContactToSaved,
  rawFiles,
  onUpdateRawFiles,
}: CardMergerProps) {
  const [activePairId, setActivePairId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isParsingId, setIsParsingId] = useState<string | null>(null);
  const [isMultiSaving, setIsMultiSaving] = useState(false);
  const [multiSaveProgress, setMultiSaveProgress] = useState({ current: 0, total: 0 });

  // Detail panel editor state
  const [editingCard, setEditingCard] = useState<ParsedCard | null>(null);
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [isSavingContact, setIsSavingContact] = useState(false);
  const [currentMergedBlob, setCurrentMergedBlob] = useState<Blob | null>(null);

  // Filter pairs
  useEffect(() => {
    if (pairs.length > 0 && !activePairId) {
      setActivePairId(pairs[0].id);
    } else if (pairs.length === 0) {
      setActivePairId(null);
    }
  }, [pairs, activePairId]);

  const activePair = pairs.find((p) => p.id === activePairId) || null;

  // Single Merge & Save Core Logic
  const handleMergeAndSavePair = async (pair: CardPair): Promise<string | null> => {
    if (!token || !mergedFolderId) return null;

    try {
      onUpdatePair({ ...pair, status: "merging", error: undefined });

      const { downloadFileAsBlob, uploadMergedCard } = await import("../utils/driveApi");

      // 1. Download front and back images safely as raw Blobs
      const frontBlob = await downloadFileAsBlob(token, pair.frontFile.id);
      let backBlob: Blob | null = null;
      if (pair.backFile) {
        backBlob = await downloadFileAsBlob(token, pair.backFile.id);
      }

      // 2. Perform Canvas compilation off-screen
      const mergedBlob = await compileUnifiedBlob(frontBlob, backBlob, pair.layout, pair.gapSize, pair.spacerColor);

      // 3. Perform Drive save
      onUpdatePair({ ...pair, status: "saving" });
      let filename = "";
      if (pair.parsedData && pair.parsedData.name) {
        const company = pair.parsedData.company ? pair.parsedData.company.trim().replace(/[/\\?%*:|"<>\s+]/g, "_") : "";
        const name = pair.parsedData.name.trim().replace(/[/\\?%*:|"<>\s+]/g, "_");
        filename = `${company ? company + "+" : ""}${name}.jpg`;
      } else {
        filename = `Merged_${pair.frontFile.name.replace(/\.[^/.]+$/, "")}${
          pair.backFile ? "_" + pair.backFile.name.replace(/\.[^/.]+$/, "") : ""
        }.jpg`;
      }

      const savedFileId = await uploadMergedCard(token, mergedFolderId, filename, mergedBlob);

      onUpdatePair({
        ...pair,
        status: "saved",
        mergedFileId: savedFileId,
      });

      return savedFileId;
    } catch (err: any) {
      console.error("Merge error:", err);
      onUpdatePair({
        ...pair,
        status: "error",
        error: err.message || "Failed to merge and upload card",
      });
      return null;
    }
  };

  // Canvas assembler drawing routine
  const compileUnifiedBlob = (
    front: Blob,
    back: Blob | null,
    layout: "horizontal" | "vertical",
    gap: number,
    color: string
  ): Promise<Blob> => {
    return new Promise((resolve, reject) => {
      const imgFront = new Image();
      imgFront.crossOrigin = "anonymous";
      imgFront.src = URL.createObjectURL(front);

      imgFront.onload = () => {
        if (!back) {
          // No back card to stitch. Just compress and forward the front card
          const canvas = document.createElement("canvas");
          canvas.width = imgFront.naturalWidth;
          canvas.height = imgFront.naturalHeight;
          const ctx = canvas.getContext("2d");
          if (!ctx) return reject("No Canvas 2D ctx");
          ctx.drawImage(imgFront, 0, 0);
          canvas.toBlob((b) => (b ? resolve(b) : reject("Blob creation error")), "image/jpeg", 0.95);
          return;
        }

        const imgBack = new Image();
        imgBack.crossOrigin = "anonymous";
        imgBack.src = URL.createObjectURL(back);

        imgBack.onload = () => {
          const canvas = document.createElement("canvas");
          const ctx = canvas.getContext("2d");
          if (!ctx) return reject("No Canvas 2D ctx");

          if (layout === "horizontal") {
            const h = 1200; // normalized high-res height
            const w1 = (imgFront.naturalWidth / imgFront.naturalHeight) * h;
            const w2 = (imgBack.naturalWidth / imgBack.naturalHeight) * h;

            canvas.width = w1 + w2 + gap;
            canvas.height = h;

            // Fill background spacer line
            ctx.fillStyle = color === "none" ? "#ffffff" : color;
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Draw front & back
            ctx.drawImage(imgFront, 0, 0, w1, h);
            ctx.drawImage(imgBack, w1 + gap, 0, w2, h);
          } else {
            const w = 1200; // normalized high-res width
            const h1 = (imgFront.naturalHeight / imgFront.naturalWidth) * w;
            const h2 = (imgBack.naturalHeight / imgBack.naturalWidth) * w;

            canvas.width = w;
            canvas.height = h1 + h2 + gap;

            // Fill background
            ctx.fillStyle = color === "none" ? "#ffffff" : color;
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Draw front & back
            ctx.drawImage(imgFront, 0, 0, w, h1);
            ctx.drawImage(imgBack, 0, h1 + gap, w, h2);
          }

          canvas.toBlob((b) => {
            // Revoke URLs to free memory
            URL.revokeObjectURL(imgFront.src);
            URL.revokeObjectURL(imgBack.src);

            if (b) resolve(b);
            else reject("Failed to output card JPEG");
          }, "image/jpeg", 0.92);
        };
        imgBack.onerror = () => reject("Failed to load back side image asset");
      };
      imgFront.onerror = () => reject("Failed to load front side image asset");
    });
  };

  // Run the sequence of multi-saving across multiple card items in the list
  const handleMultiSaveAll = async () => {
    if (pairs.length === 0) return;
    setIsMultiSaving(true);
    setMultiSaveProgress({ current: 0, total: pairs.length });

    for (let i = 0; i < pairs.length; i++) {
      const pair = pairs[i];
      if (pair.status !== "saved") {
        setMultiSaveProgress({ current: i + 1, total: pairs.length });
        await handleMergeAndSavePair(pair);
      }
    }

    setIsMultiSaving(false);
  };

  // Run AI parsing on a merged card
  const handleParseCardWithAI = async (pair: CardPair) => {
    if (!token) return;
    setIsParsingId(pair.id);

    try {
      onUpdatePair({ ...pair, status: "parsing" });

      const { downloadFileAsBlob } = await import("../utils/driveApi");

      // 1. Compile locally on the client to a binary blob first to feed the parser
      const frontBlob = await downloadFileAsBlob(token, pair.frontFile.id);
      let backBlob: Blob | null = null;
      if (pair.backFile) {
        backBlob = await downloadFileAsBlob(token, pair.backFile.id);
      }

      const mergedBlob = await compileUnifiedBlob(frontBlob, backBlob, pair.layout, pair.gapSize, pair.spacerColor);
      setCurrentMergedBlob(mergedBlob);

      // Convert combined JPEG blob to base64
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(mergedBlob);
        reader.onloadend = () => {
          if (reader.result) resolve(reader.result as string);
          else reject("Base64 reading failed");
        };
      });

      // 2. Call backend express proxy with the base64 compiled card to run Gemini AI parser
      const res = await fetch("/api/parser", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base64: base64Data, mimeType: "image/jpeg" }),
      });

      if (!res.ok) {
        const errJson = await res.json();
        throw new Error(errJson.error || "Gemini parsing server error");
      }

      const contactResult: ParsedCard = await res.json();

      if (pair.mergedFileId) {
        try {
          const company = contactResult.company ? contactResult.company.trim().replace(/[/\\?%*:|"<>\s+]/g, "_") : "";
          const name = contactResult.name.trim().replace(/[/\\?%*:|"<>\s+]/g, "_");
          const newName = `${company ? company + "+" : ""}${name}.jpg`;
          
          const { renameFileInDrive } = await import("../utils/driveApi");
          await renameFileInDrive(token, pair.mergedFileId, newName);
          console.log(`Renamed merged file in Drive to ${newName}`);
        } catch (renameErr) {
          console.error("Failed to rename file after AI parsing:", renameErr);
        }
      }

      onUpdatePair({
        ...pair,
        status: "parsed",
        parsedData: contactResult,
      });

      // Open side-deck immediately for the parsed details
      setEditingCard(contactResult);
      setEditingCardId(pair.id);
    } catch (err: any) {
      console.error("AI Parse Error:", err);
      onUpdatePair({
        ...pair,
        status: "error",
        error: `AI Parsing Failed: ${err.message || err}`,
      });
    } finally {
      setIsParsingId(null);
    }
  };

  // Synchronise edited details back to Google Contacts, upload merged image, and archive/delete raw files
  const handleSaveToGoogleContacts = async () => {
    if (!editingCard || !editingCardId || !token) return;
    setIsSavingContact(true);

    try {
      const activePair = pairs.find((p) => p.id === editingCardId);
      if (!activePair) throw new Error("Active pair not found in queue");

      const { saveGoogleContact, uploadMergedCard, trashFileFromDrive } = await import("../utils/driveApi");

      // 1. Compile the merged blob if not already in state
      let mergedBlob = currentMergedBlob;
      if (!mergedBlob) {
        const { downloadFileAsBlob } = await import("../utils/driveApi");
        const frontBlob = await downloadFileAsBlob(token, activePair.frontFile.id);
        const backBlob = activePair.backFile ? await downloadFileAsBlob(token, activePair.backFile.id) : null;
        mergedBlob = await compileUnifiedBlob(frontBlob, backBlob, activePair.layout, activePair.gapSize, activePair.spacerColor);
      }

      // 2. Generate filename: CompanyName+ContactName.jpg
      const company = editingCard.company ? editingCard.company.trim().replace(/[/\\?%*:|"<>\s+]/g, "_") : "";
      const name = editingCard.name.trim().replace(/[/\\?%*:|"<>\s+]/g, "_");
      const filename = `${company ? company + "+" : ""}${name}.jpg`;

      // 3. Save Merged Card to Google Drive
      console.log(`Saving merged card to Drive: ${filename}`);
      await uploadMergedCard(token, mergedFolderId, filename, mergedBlob);

      // 4. Save contact to Google Contacts CRM
      console.log("Saving contact to Google Contacts...");
      await saveGoogleContact(token, editingCard);

      // 5. Delete source files from Google Drive
      const frontId = activePair.frontFile.id;
      const backId = activePair.backFile?.id;

      console.log(`Deleting source file from Drive: ${frontId}`);
      await trashFileFromDrive(token, frontId);
      if (backId) {
        console.log(`Deleting source file from Drive: ${backId}`);
        await trashFileFromDrive(token, backId);
      }

      // 6. Update local files list to filter out deleted files
      const updatedRawFiles = rawFiles.filter((f) => f.id !== frontId && f.id !== backId);
      onUpdateRawFiles(updatedRawFiles);

      // 7. Save locally to logged history
      onAddContactToSaved(editingCard, editingCardId);

      // 8. Remove the completed pair from queue
      onRemovePair(editingCardId);

      // 9. Auto-select next pair in queue if available
      const remainingPairs = pairs.filter((p) => p.id !== editingCardId);
      if (remainingPairs.length > 0) {
        setActivePairId(remainingPairs[0].id);
      } else {
        setActivePairId(null);
      }

      alert("Successfully merged card, saved contact, and archived/deleted raw scans!");
      
      // Close side panel
      setEditingCard(null);
      setEditingCardId(null);
      setCurrentMergedBlob(null);

    } catch (err: any) {
      console.error("Archiving/publishing failed:", err);
      alert(`Operation failed: ${err.message || err}`);
    } finally {
      setIsSavingContact(false);
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
      {/* Target queue workspace left panel */}
      <div className="xl:col-span-1 bg-white/[0.03] backdrop-blur-md border border-white/[0.08] shadow-[0_8px_32px_0_rgba(0,0,0,0.3)] p-5 flex flex-col h-[600px] rounded-2xl">
        <div className="flex items-center justify-between border-b border-white/[0.06] pb-3 mb-3">
          <div className="flex items-center gap-1.5">
            <Sliders className="w-4 h-4 text-indigo-400" />
            <h3 className="font-semibold text-white font-display text-sm">Review Queue</h3>
          </div>
          <span className="bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 text-xs font-semibold px-2.5 py-0.5 rounded-full">
            {pairs.length} Items
          </span>
        </div>

        {pairs.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-4">
            <p className="text-xs text-slate-400">Queue is empty</p>
            <p className="text-[11px] text-slate-500 mt-2 max-w-[160px] leading-relaxed mx-auto border border-dashed border-white/[0.05] p-3 rounded-xl bg-white/[0.01]">
              Select card images from the Google Drive browser below to pair them up.
            </p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto space-y-2 pr-1">
            {pairs.map((pair) => {
              const isActive = pair.id === activePairId;
              return (
                <div
                  key={pair.id}
                  onClick={() => setActivePairId(pair.id)}
                  className={`p-3 rounded-xl border transition-all cursor-pointer flex items-center justify-between group ${
                    isActive
                      ? "border-indigo-500 bg-white/[0.08] shadow-[0_0_15px_rgba(99,102,241,0.15)]"
                      : "border-white/[0.04] hover:border-white/[0.1] bg-white/[0.01]"
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold text-white truncate leading-snug">
                      {pair.frontFile.name}
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] text-slate-400 capitalize">{pair.layout} card</span>
                      <span
                        className={`text-[9px] px-1.5 py-0.5 rounded-full font-semibold capitalize ${
                          pair.status === "saved" || pair.status === "parsed"
                            ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                            : pair.status === "error"
                            ? "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                            : pair.status === "merging" || pair.status === "saving" || pair.status === "parsing"
                            ? "bg-amber-500/10 text-amber-400 border border-amber-500/20 animate-pulse"
                            : "bg-white/[0.04] text-slate-400 border border-white/[0.04]"
                        }`}
                      >
                        {pair.status}
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemovePair(pair.id);
                    }}
                    className="p-1 text-slate-500 hover:text-rose-400 transition-colors opacity-0 group-hover:opacity-100 cursor-pointer"
                    title="Remove from workspace"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        )}

        {pairs.length > 0 && (
          <div className="pt-3 border-t border-white/[0.06] space-y-2">
            <button
              type="button"
              id="btn-multi-save"
              disabled={isMultiSaving || isProcessing}
              onClick={handleMultiSaveAll}
              className="w-full py-2.5 bg-gradient-to-r from-indigo-500 to-blue-500 hover:from-indigo-600 hover:to-blue-600 disabled:opacity-40 text-white text-xs font-bold rounded-xl transition-all shadow-md flex items-center justify-center gap-2 cursor-pointer"
            >
              {isMultiSaving ? (
                <>
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                  Stitching ({multiSaveProgress.current}/{multiSaveProgress.total})...
                </>
              ) : (
                <>
                  <Save className="w-3.5 h-3.5" />
                  Save All (Multi-Save)
                </>
              )}
            </button>
            <button
              type="button"
              id="btn-clear-queue"
              onClick={onClearAll}
              className="w-full py-2 bg-white/[0.02] text-slate-300 hover:text-white text-xs font-semibold rounded-xl border border-white/[0.08] hover:border-white/[0.15] transition-all cursor-pointer text-center"
            >
              Clear Workspace Queue
            </button>
          </div>
        )}
      </div>

      {/* Main active stitching deck center panel */}
      <div className="xl:col-span-2 bg-white/[0.03] backdrop-blur-md border border-white/[0.08] shadow-[0_8px_32px_0_rgba(0,0,0,0.3)] p-6 flex flex-col h-[600px] rounded-2xl">
        {activePair ? (
          <div className="flex flex-col h-full">
            {/* Action Bar */}
            <div className="flex border-b border-white/[0.06] pb-4 mb-4 items-center justify-between">
              <div className="min-w-0 pr-2">
                <span className="text-[10px] text-indigo-400 font-bold uppercase tracking-widest block font-sans">
                  Active Workspace Stitcher
                </span>
                <h4 className="text-sm font-bold text-white font-display truncate leading-tight mt-1" title={activePair.frontFile.name}>
                  {activePair.frontFile.name}
                </h4>
              </div>

              <div className="flex gap-2 shrink-0">
                <span className="text-[10px] bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 text-xs font-semibold px-2.5 py-0.5 rounded-full capitalize">
                  {activePair.status}
                </span>
              </div>
            </div>

            {/* Editing configs */}
            <div className="grid grid-cols-3 gap-3 mb-4 text-xs">
              <div>
                <label className="block text-[9px] text-slate-400 uppercase font-semibold mb-1 tracking-wider">Layout</label>
                <div className="flex gap-1 bg-black/25 p-1 rounded-lg border border-white/[0.04]">
                  <button
                    type="button"
                    onClick={() => onUpdatePair({ ...activePair, layout: "horizontal" })}
                    className={`flex-1 flex py-1 justify-center items-center gap-1 rounded text-[10px] transition-all cursor-pointer ${
                      activePair.layout === "horizontal"
                        ? "bg-white/[0.08] text-white border border-white/[0.08] font-bold"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    <Columns className="w-3 h-3" /> Side-by-Side
                  </button>
                  <button
                    type="button"
                    onClick={() => onUpdatePair({ ...activePair, layout: "vertical" })}
                    className={`flex-1 flex py-1 justify-center items-center gap-1 rounded text-[10px] transition-all cursor-pointer ${
                      activePair.layout === "vertical"
                        ? "bg-white/[0.08] text-white border border-white/[0.08] font-bold"
                        : "text-slate-400 hover:text-white"
                    }`}
                  >
                    <Grid className="w-3 h-3" /> Vertically Stood
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-[9px] text-slate-400 uppercase font-semibold mb-1 tracking-wider">Gap Size (px)</label>
                <input
                  type="number"
                  min="0"
                  max="50"
                  value={activePair.gapSize}
                  onChange={(e) => onUpdatePair({ ...activePair, gapSize: parseInt(e.target.value) || 0 })}
                  className="w-full bg-black/25 border border-white/[0.08] text-white rounded-lg p-1 text-center font-bold outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-[9px] text-slate-400 uppercase font-semibold mb-1 tracking-wider">Spacer Line</label>
                <select
                  value={activePair.spacerColor}
                  onChange={(e) => onUpdatePair({ ...activePair, spacerColor: e.target.value })}
                  className="w-full bg-black/25 border border-white/[0.08] text-white rounded-lg p-1.5 font-semibold outline-none focus:border-indigo-500"
                >
                  <option value="#ffffff" className="bg-slate-900 text-white">White Spacer</option>
                  <option value="#f1f5f9" className="bg-slate-900 text-white">Slate Gap</option>
                  <option value="#0f172a" className="bg-slate-900 text-white">Dark Spacer</option>
                  <option value="#000000" className="bg-slate-900 text-white">Black Spacer</option>
                </select>
              </div>
            </div>

            {/* Workspace live render canvas / preview space */}
            <div className="flex-1 bg-black/20 rounded-xl border border-white/[0.06] overflow-hidden flex flex-col items-center justify-between p-4 relative">
              <div className="flex-1 w-full flex flex-col md:flex-row gap-6 items-center justify-center overflow-y-auto max-h-[420px] p-2">
                {/* Front side card display */}
                <div className="flex flex-col items-center space-y-2">
                  <span className="text-[10px] text-indigo-400 font-bold uppercase tracking-wider">
                    Front Side Card
                  </span>
                  <div className="aspect-[3/2] w-56 md:w-64 overflow-hidden rounded-xl bg-black/40 shadow-lg border border-white/[0.08] relative">
                    {activePair.frontFile.thumbnailLink ? (
                      <img
                        src={activePair.frontFile.thumbnailLink.replace(/=s\d+/, "=s500")}
                        alt="Front"
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <span className="text-xs text-slate-500 flex items-center justify-center h-full">Front image</span>
                    )}
                  </div>
                  
                  {/* Front visual scroller */}
                  <div className="w-56 md:w-64">
                    <div className="flex gap-2 overflow-x-auto p-1.5 border border-white/[0.06] rounded-xl bg-black/30 h-20 items-center scrollbar-thin scrollbar-thumb-indigo-500/50 scrollbar-track-transparent">
                      {rawFiles.map((file) => {
                        const isSelected = activePair.frontFile.id === file.id;
                        return (
                          <button
                            key={file.id}
                            type="button"
                            onClick={() => {
                              onUpdatePair({
                                ...activePair,
                                frontFile: file,
                                name: file.name,
                              });
                            }}
                            className={`h-14 w-20 flex-shrink-0 rounded-lg overflow-hidden border transition-all cursor-pointer relative ${
                              isSelected
                                ? "border-indigo-500 ring-2 ring-indigo-500/25 shadow-md shadow-indigo-500/25 scale-95"
                                : "border-white/[0.06] hover:border-white/[0.15] opacity-70 hover:opacity-100"
                            }`}
                            title={file.name}
                          >
                            {file.thumbnailLink ? (
                              <img
                                src={file.thumbnailLink}
                                alt={file.name}
                                referrerPolicy="no-referrer"
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <span className="text-[9px] text-slate-500 flex items-center justify-center h-full">No image</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                </div>

                <ArrowRight className="hidden md:block w-6 h-6 text-slate-500 shrink-0" />

                {/* Back side card display */}
                <div className="flex flex-col items-center space-y-2">
                  <span className="text-[10px] text-indigo-400 font-bold uppercase tracking-wider">
                    Back Side Card
                  </span>
                  <div className="aspect-[3/2] w-56 md:w-64 overflow-hidden rounded-xl bg-black/40 shadow-lg border border-white/[0.08] relative flex items-center justify-center">
                    {activePair.backFile ? (
                      <>
                        <img
                          src={activePair.backFile.thumbnailLink?.replace(/=s\d+/, "=s500")}
                          alt="Back"
                          className="w-full h-full object-contain"
                        />
                        <button
                          type="button"
                          onClick={() => onUpdatePair({ ...activePair, backFile: undefined })}
                          className="absolute top-2 right-2 bg-black/60 hover:bg-rose-500/20 text-rose-400 p-1.5 rounded-lg border border-white/[0.06] shadow-sm transition-colors cursor-pointer"
                          title="Clear Back Side"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    ) : (
                      <div className="text-center p-4 text-xs text-slate-500 flex flex-col items-center justify-center leading-normal">
                        <span className="italic block font-semibold text-slate-400">No back side selected</span>
                        <span className="text-[10px] opacity-65 mt-1">Select visual thumbnail below</span>
                      </div>
                    )}
                  </div>
                  
                  {/* Back visual scroller */}
                  <div className="w-56 md:w-64">
                    <div className="flex gap-2 overflow-x-auto p-1.5 border border-white/[0.06] rounded-xl bg-black/30 h-20 items-center scrollbar-thin scrollbar-thumb-indigo-500/50 scrollbar-track-transparent">
                      {/* "None" option */}
                      <button
                        type="button"
                        onClick={() => {
                          onUpdatePair({
                            ...activePair,
                            backFile: undefined,
                          });
                        }}
                        className={`h-14 w-20 flex-shrink-0 rounded-lg overflow-hidden border transition-all cursor-pointer flex flex-col items-center justify-center text-[9px] font-bold ${
                          !activePair.backFile
                            ? "border-indigo-500 bg-indigo-500/10 text-indigo-400 ring-2 ring-indigo-500/25 scale-95"
                            : "border-white/[0.06] hover:border-white/[0.15] text-slate-400 hover:text-slate-200 bg-white/[0.02]"
                        }`}
                      >
                        No Back
                      </button>

                      {rawFiles
                        .filter((f) => f.id !== activePair.frontFile.id)
                        .map((file) => {
                          const isSelected = activePair.backFile?.id === file.id;
                          return (
                            <button
                              key={file.id}
                              type="button"
                              onClick={() => {
                                onUpdatePair({
                                  ...activePair,
                                  backFile: file,
                                });
                              }}
                              className={`h-14 w-20 flex-shrink-0 rounded-lg overflow-hidden border transition-all cursor-pointer relative ${
                                isSelected
                                  ? "border-indigo-500 ring-2 ring-indigo-500/25 shadow-md shadow-indigo-500/25 scale-95"
                                  : "border-white/[0.06] hover:border-white/[0.15] opacity-70 hover:opacity-100"
                              }`}
                              title={file.name}
                            >
                              {file.thumbnailLink ? (
                                <img
                                  src={file.thumbnailLink}
                                  alt={file.name}
                                  referrerPolicy="no-referrer"
                                  className="w-full h-full object-cover"
                                />
                              ) : (
                                <span className="text-[9px] text-slate-500 flex items-center justify-center h-full">No image</span>
                              )}
                            </button>
                          );
                        })}
                    </div>
                  </div>
                </div>
              </div>

              {/* Action trigger button below images */}
              <div className="w-full pt-4 border-t border-white/[0.06] flex justify-center shrink-0">
                <button
                  type="button"
                  id="btn-stitch-and-parse"
                  disabled={activePair.status === "parsing" || isParsingId !== null}
                  onClick={() => handleParseCardWithAI(activePair)}
                  className="w-full max-w-md py-3 px-6 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 hover:from-indigo-600 hover:via-purple-600 hover:to-pink-600 text-white rounded-xl text-xs font-bold transition-all shadow-[0_4px_20px_rgba(168,85,247,0.35)] hover:shadow-[0_4px_25px_rgba(168,85,247,0.6)] flex items-center justify-center gap-2 cursor-pointer"
                >
                  {isParsingId === activePair.id ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <Sparkles className="w-4 h-4" />
                  )}
                  Stitch and Run AI Parser
                </button>
              </div>

              {/* Status / Log notification elements in workframe */}
              {activePair.status !== "idle" && (
                <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex flex-col items-center justify-center p-4 z-20">
                  <div className="bg-[#0e1321] border border-white/[0.1] shadow-2xl p-6 rounded-2xl max-w-sm w-full text-center space-y-4">
                    {activePair.status === "merging" || activePair.status === "saving" || activePair.status === "parsing" ? (
                      <div className="space-y-3 py-2">
                        <RefreshCw className="w-8 h-8 text-indigo-400 animate-spin mx-auto" />
                        <h5 className="font-bold font-display text-white capitalize text-sm">{activePair.status} Card...</h5>
                        <p className="text-xs text-slate-400 leading-relaxed">
                          Synchronizing binary structures with workspace directories & running Gemini AI parsing. Please wait.
                        </p>
                      </div>
                    ) : activePair.status === "saved" || activePair.status === "parsed" ? (
                      <div className="space-y-3 text-center">
                        <CheckCircle className="w-8 h-8 text-emerald-400 mx-auto" />
                        <h5 className="font-bold font-display text-white text-sm">Combined Card Complete</h5>
                        <p className="text-xs text-slate-400 leading-relaxed">
                          {activePair.status === "saved"
                            ? "Stitched visual card document successfully uploaded and synchronized into Merged_Bus_Cards folder."
                            : "Gemini AI profile extraction completed. Review details inside CRM sheet."}
                        </p>
                        <div className="pt-2 flex gap-2 justify-center">
                          {activePair.mergedFileId && (
                            <a
                              href={`https://drive.google.com/file/d/${activePair.mergedFileId}/view`}
                              target="_blank"
                              rel="noreferrer"
                              className="px-3 py-1.5 bg-white/[0.05] border border-white/[0.08] text-slate-200 hover:bg-white/[0.1] rounded-lg text-xs font-semibold transition-colors animate-pulse"
                            >
                              View on Drive
                            </a>
                          )}
                          <button
                            type="button"
                            onClick={() => onUpdatePair({ ...activePair, status: "idle" })}
                            className="px-3.5 py-1.5 bg-gradient-to-r from-indigo-500 to-blue-500 hover:from-indigo-600 hover:to-blue-600 text-white rounded-lg text-xs font-semibold cursor-pointer shadow-md transition-all"
                          >
                            Dismiss Window
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-3 text-center">
                        <AlertTriangle className="w-8 h-8 text-rose-400 mx-auto" />
                        <h5 className="font-bold font-display text-white text-sm">Action Blocked</h5>
                        <p className="text-xs text-rose-300 leading-relaxed max-h-24 overflow-y-auto">{activePair.error || "An unexpected error occurred."}</p>
                        <button
                          type="button"
                          onClick={() => onUpdatePair({ ...activePair, status: "idle" })}
                          className="px-4 py-2 bg-white/[0.05] hover:bg-white/[0.1] border border-white/[0.08] text-white rounded-lg text-xs font-semibold cursor-pointer transition-colors"
                        >
                          Dismiss Workspace
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center border border-dashed border-white/[0.06] bg-white/[0.01] rounded-xl py-12 text-center text-slate-400">
            <Columns className="w-12 h-12 text-slate-600 mb-3 animate-pulse" />
            <p className="text-sm font-semibold text-slate-300 font-display">Active Stitcher Empty</p>
            <p className="text-xs max-w-xs px-4 mt-2 leading-relaxed">
              Select or suggest card files in the bottom drawer directory to open the layout assembly canvas.
            </p>
          </div>
        )}
      </div>

      {/* Structured parsed details contact cards right sheet */}
      <div className="xl:col-span-1 bg-white/[0.03] backdrop-blur-md border border-white/[0.08] shadow-[0_8px_32px_0_rgba(0,0,0,0.3)] p-5 flex flex-col h-[600px] overflow-hidden rounded-2xl">
        <div className="flex items-center justify-between border-b border-white/[0.06] pb-3 mb-3">
          <div className="flex items-center gap-1.5">
            <Contact className="w-4 h-4 text-indigo-400" />
            <h3 className="font-semibold text-white font-display text-sm">CRM AI Contact Panel</h3>
          </div>
        </div>

        {editingCard ? (
          <div className="flex-1 flex flex-col h-full overflow-hidden text-xs">
            <div className="flex-1 overflow-y-auto space-y-3 pr-1 pb-4">
              <div>
                <label className="block text-[9px] text-slate-400 uppercase font-semibold mb-1 tracking-wider">Name *</label>
                <input
                  type="text"
                  value={editingCard.name}
                  onChange={(e) => setEditingCard({ ...editingCard, name: e.target.value })}
                  className="w-full bg-white/[0.02] border border-white/[0.08] rounded-lg p-1.5 focus:bg-white/[0.06] text-white font-bold tracking-tight focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-[9px] text-slate-400 uppercase font-semibold mb-1 tracking-wider">Company</label>
                <input
                  type="text"
                  value={editingCard.company}
                  onChange={(e) => setEditingCard({ ...editingCard, company: e.target.value })}
                  className="w-full bg-white/[0.02] border border-white/[0.08] rounded-lg p-1.5 focus:bg-white/[0.06] text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-[9px] text-slate-400 uppercase font-semibold mb-1 tracking-wider">Job Title</label>
                <input
                  type="text"
                  value={editingCard.title}
                  onChange={(e) => setEditingCard({ ...editingCard, title: e.target.value })}
                  className="w-full bg-white/[0.02] border border-white/[0.08] rounded-lg p-1.5 focus:bg-white/[0.06] text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-[9px] text-slate-400 uppercase font-semibold mb-1 tracking-wider">Emails</label>
                <input
                  type="text"
                  value={editingCard.emails.join(", ")}
                  onChange={(e) =>
                    setEditingCard({
                      ...editingCard,
                      emails: e.target.value.split(",").map((em) => em.trim()).filter(Boolean),
                    })
                  }
                  placeholder="name@company.com"
                  className="w-full bg-white/[0.02] border border-white/[0.08] rounded-lg p-1.5 focus:bg-white/[0.06] text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-[9px] text-slate-400 uppercase font-semibold mb-1 tracking-wider">Phone Numbers</label>
                <input
                  type="text"
                  value={editingCard.phones.join(", ")}
                  onChange={(e) =>
                    setEditingCard({
                      ...editingCard,
                      phones: e.target.value.split(",").map((ph) => ph.trim()).filter(Boolean),
                    })
                  }
                  placeholder="+65 1234 5678"
                  className="w-full bg-white/[0.02] border border-white/[0.08] rounded-lg p-1.5 focus:bg-white/[0.06] text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-[9px] text-slate-400 uppercase font-semibold mb-1 tracking-wider">Company Websites</label>
                <input
                  type="text"
                  value={editingCard.websites.join(", ")}
                  onChange={(e) =>
                    setEditingCard({
                      ...editingCard,
                      websites: e.target.value.split(",").map((w) => w.trim()).filter(Boolean),
                    })
                  }
                  placeholder="www.company.com"
                  className="w-full bg-white/[0.02] border border-white/[0.08] rounded-lg p-1.5 focus:bg-white/[0.06] text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-[9px] text-slate-400 uppercase font-semibold mb-1 tracking-wider">Address</label>
                <textarea
                  value={editingCard.address}
                  onChange={(e) => setEditingCard({ ...editingCard, address: e.target.value })}
                  className="w-full bg-white/[0.02] border border-white/[0.08] rounded-lg p-1.5 focus:bg-white/[0.06] text-white focus:outline-none focus:border-indigo-500 resize-none h-14"
                />
              </div>

              <div>
                <label className="block text-[9px] text-slate-400 uppercase font-semibold mb-1 tracking-wider">LinkedIn / Socials</label>
                <input
                  type="text"
                  value={editingCard.socials.join(", ")}
                  onChange={(e) =>
                    setEditingCard({
                      ...editingCard,
                      socials: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                    })
                  }
                  className="w-full bg-white/[0.02] border border-white/[0.08] rounded-lg p-1.5 focus:bg-white/[0.06] text-white focus:outline-none focus:border-indigo-500"
                />
              </div>

              <div>
                <label className="block text-[9px] text-slate-400 uppercase font-semibold mb-1 tracking-wider">AI Card Insights</label>
                <textarea
                  value={editingCard.notes}
                  onChange={(e) => setEditingCard({ ...editingCard, notes: e.target.value })}
                  className="w-full bg-white/[0.02] border border-white/[0.08] rounded-lg p-1.5 focus:bg-white/[0.06] text-white focus:outline-none focus:border-indigo-500 resize-none h-16"
                />
              </div>
            </div>

            <div className="border-t border-white/[0.06] pt-3 space-y-2 shrink-0">
              <button
                type="button"
                id="btn-save-contact"
                disabled={isSavingContact || !editingCard.name}
                onClick={handleSaveToGoogleContacts}
                className="w-full py-2.5 bg-gradient-to-r from-indigo-500 to-blue-500 hover:from-indigo-600 hover:to-blue-600 disabled:opacity-40 text-white text-xs font-bold rounded-xl shadow-md transition-all flex items-center justify-center gap-1.5 cursor-pointer"
              >
                {isSavingContact ? (
                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Users className="w-3.5 h-3.5" />
                )}
                Publish to Contacts
              </button>
              <button
                type="button"
                onClick={() => setEditingCard(null)}
                className="w-full py-1.5 bg-white/[0.02] hover:bg-white/[0.06] border border-white/[0.06] text-slate-400 hover:text-slate-200 text-[10px] font-semibold rounded-lg text-center cursor-pointer transition-colors"
              >
                Discard / Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-center p-4 text-slate-400 bg-white/[0.01] border border-dashed border-white/[0.04] rounded-xl">
            <Sparkles className="w-10 h-10 text-slate-700 animate-pulse mb-3" />
            <p className="text-xs font-semibold text-slate-300">No Parsed Contact Selected</p>
            <p className="text-[10px] text-slate-500 font-medium leading-relaxed px-2 mt-1.5">
              Select any card in your workspace or scanned files directory, and run the <strong>AI Parser</strong> to extract structure coordinates directly into this editable sheet.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

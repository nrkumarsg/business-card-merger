import React, { useState, useEffect } from "react";
import { FolderHeart, RefreshCw, Trash2, Eye, Download, ExternalLink, Sparkles } from "lucide-react";
import { DriveFile, ParsedCard } from "../types";

interface MergedCollectionProps {
  token: string | null;
  mergedFolderId: string;
  isLoading: boolean;
  onRefresh: () => void;
  onAddContactToSaved: (contact: ParsedCard, cardId: string) => void;
  onOpenAiSheet: (data: ParsedCard, cardId: string) => void;
}

export default function MergedCollection({
  token,
  mergedFolderId,
  isLoading,
  onRefresh,
  onAddContactToSaved,
  onOpenAiSheet,
}: MergedCollectionProps) {
  const [mergedFiles, setMergedFiles] = useState<DriveFile[]>([]);
  const [isQuerying, setIsQuerying] = useState(false);
  const [activeViewFile, setActiveViewFile] = useState<DriveFile | null>(null);
  const [viewBlobUrl, setViewBlobUrl] = useState<string | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const [isParsingId, setIsParsingId] = useState<string | null>(null);

  // Sync / fetch files on folder ID change
  useEffect(() => {
    if (token && mergedFolderId) {
      loadMergedFiles();
    }
  }, [token, mergedFolderId]);

  const loadMergedFiles = async () => {
    if (!token || !mergedFolderId) return;
    setIsQuerying(true);
    try {
      const { listFilesByFolder } = await import("../utils/driveApi");
      const files = await listFilesByFolder(token, mergedFolderId);
      setMergedFiles(files);
    } catch (err) {
      console.error("Merged card fetch err:", err);
    } finally {
      setIsQuerying(false);
    }
  };

  // Open light-box viewer
  const handleOpenLightbox = async (file: DriveFile) => {
    setActiveViewFile(file);
    if (!token) return;
    setIsPreviewLoading(true);
    setViewBlobUrl(null);
    try {
      const { downloadFileAsBlob } = await import("../utils/driveApi");
      const blob = await downloadFileAsBlob(token, file.id);
      const url = URL.createObjectURL(blob);
      setViewBlobUrl(url);
    } catch (err) {
      console.error("Lightbox download err:", err);
    } finally {
      setIsPreviewLoading(false);
    }
  };

  const handleCloseLightbox = () => {
    setActiveViewFile(null);
    if (viewBlobUrl) {
      URL.revokeObjectURL(viewBlobUrl);
      setViewBlobUrl(null);
    }
  };

  // Remove a merged file with explicit user confirmation
  const handleDeleteMergedCard = async (file: DriveFile) => {
    if (!token) return;
    const confirmed = window.confirm(
      `Are you sure you want to permanently delete "${file.name}" from your Google Drive merged files? This action cannot be undone.`
    );
    if (!confirmed) return;

    try {
      const { trashFileFromDrive } = await import("../utils/driveApi");
      await trashFileFromDrive(token, file.id);
      setMergedFiles(mergedFiles.filter((f) => f.id !== file.id));
      if (activeViewFile?.id === file.id) {
        handleCloseLightbox();
      }
      alert("Merged card has been deleted from Google Drive.");
    } catch (err: any) {
      console.error("Delete err:", err);
      alert(`Failed to delete card file: ${err.message || err}`);
    }
  };

  // Parse a historic merged file
  const handleParseHistoricCard = async (file: DriveFile) => {
    if (!token) return;
    setIsParsingId(file.id);

    try {
      const { downloadFileAsBlob } = await import("../utils/driveApi");
      const blob = await downloadFileAsBlob(token, file.id);

      // Convert image blob to base64
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(blob);
        reader.onloadend = () => {
          if (reader.result) resolve(reader.result as string);
          else reject("Base64 reading failed");
        };
      });

      // Call server proxy
      const res = await fetch("/api/parser", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ base64: base64Data, mimeType: "image/jpeg" }),
      });

      if (!res.ok) {
        throw new Error("Failed to parse card on Gemini AI proxy");
      }

      const contact: ParsedCard = await res.json();
      onOpenAiSheet(contact, file.id);
    } catch (err: any) {
      console.error("Historical parse error:", err);
      alert(`AI parsing failed: ${err.message || err}`);
    } finally {
      setIsParsingId(null);
    }
  };

  const isLocalLoading = isLoading || isQuerying;

  return (
    <div className="bg-white/[0.03] backdrop-blur-lg border border-white/[0.08] shadow-[0_8px_32px_0_rgba(0,0,0,0.3)] rounded-2xl p-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/[0.06] pb-5 mb-6">
        <div>
          <div className="flex items-center gap-2">
            <FolderHeart className="w-5 h-5 text-indigo-400" />
            <h2 className="text-lg font-semibold text-white font-display">
              Merged Collection Drawer
            </h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Displaying processed elements inside your <strong className="text-indigo-400 font-medium font-sans">Merged_Bus_Cards</strong> Google Drive folder.
          </p>
        </div>

        <button
          type="button"
          id="btn-refresh-gallery"
          disabled={isLocalLoading}
          onClick={() => {
            onRefresh();
            loadMergedFiles();
          }}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-white/[0.04] border border-white/[0.08] hover:bg-white/[0.1] disabled:opacity-40 text-slate-300 hover:text-white text-xs font-semibold rounded-lg transition-all cursor-pointer self-start sm:self-center"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLocalLoading ? "animate-spin" : ""}`} />
          Refresh Gallery
        </button>
      </div>

      {isLocalLoading ? (
        <div className="flex flex-col items-center justify-center py-20">
          <RefreshCw className="w-8 h-8 text-indigo-400 animate-spin mb-3" />
          <p className="text-sm text-slate-400 font-medium">Scanning folders...</p>
        </div>
      ) : mergedFiles.length === 0 ? (
        <div className="text-center py-20 border border-dashed border-white/[0.08] rounded-2xl bg-white/[0.01]">
          <FolderHeart className="w-12 h-12 text-slate-600 mx-auto mb-3 animate-pulse" />
          <h4 className="text-sm font-semibold text-slate-300 font-display">Folder currently empty</h4>
          <p className="text-xs text-slate-400 mt-2 max-w-sm mx-auto leading-relaxed">
            There are no documents stored in this directory. Pair and upload card image front/back assets inside the <strong>Workspace Workstand</strong> tab to save them here!
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
          {mergedFiles.map((file) => (
            <div
              key={file.id}
              className="group border border-white/[0.05] rounded-2xl overflow-hidden bg-white/[0.01]/50 hover:bg-white/[0.04] hover:shadow-[0_8px_24px_rgba(0,0,0,0.4)] hover:border-white/[0.12] transition-all flex flex-col relative"
            >
              <div className="aspect-[3/2] overflow-hidden bg-black/25 border-b border-white/[0.04] relative items-center justify-center flex">
                {file.thumbnailLink ? (
                  <img
                    src={file.thumbnailLink}
                    alt={file.name}
                    referrerPolicy="no-referrer"
                    className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-200"
                  />
                ) : (
                  <span className="text-xs text-slate-500 text-center italic font-medium">No direct preview</span>
                )}

                {/* Dark preview overlays */}
                <div className="absolute inset-0 bg-slate-950/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={() => handleOpenLightbox(file)}
                    className="p-1.5 bg-white text-slate-900 hover:bg-slate-100 rounded-lg shadow-md transition-colors cursor-pointer"
                    title="Zoom Screen"
                  >
                    <Eye className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    disabled={isParsingId === file.id}
                    onClick={() => handleParseHistoricCard(file)}
                    className="p-1.5 bg-gradient-to-r from-indigo-500 via-purple-500 to-pink-500 text-white rounded-lg shadow-md disabled:opacity-50 transition-colors cursor-pointer"
                    title="Process with Gemini AI Panel"
                  >
                    {isParsingId === file.id ? (
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleDeleteMergedCard(file)}
                    className="p-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg shadow-md transition-colors cursor-pointer"
                    title="Trash card"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <div className="p-4 flex-1 flex flex-col justify-between">
                <div className="min-w-0">
                  <h4 className="text-xs font-bold text-slate-200 truncate" title={file.name}>
                    {file.name}
                  </h4>
                  <p className="text-[10px] text-slate-500 mt-1">
                    Added: {file.createdTime ? new Date(file.createdTime).toLocaleDateString() : ""}
                  </p>
                </div>

                <div className="mt-3 pt-3 border-t border-white/[0.04] flex items-center justify-between text-[10px]">
                  <a
                    href={`https://drive.google.com/file/d/${file.id}/view`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-indigo-400 hover:text-indigo-300 font-bold flex items-center gap-1 transition-colors"
                  >
                    Drive Asset <ExternalLink className="w-2.5 h-2.5" />
                  </a>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Lightbox Modal overlay popup screen */}
      {activeViewFile && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-black/80 backdrop-blur-md flex items-center justify-center p-4 md:p-10">
          <div className="bg-[#0e1321] border border-white/[0.1] rounded-2xl shadow-2xl max-w-4xl w-full overflow-hidden flex flex-col max-h-[85vh] relative animate-in zoom-in-95 duration-150">
            <div className="bg-white/[0.01]/80 px-6 py-4 border-b border-white/[0.06] flex items-center justify-between">
              <div className="min-w-0">
                <span className="text-[9px] text-indigo-400 uppercase font-bold tracking-widest block font-sans">Lightbox view</span>
                <h3 className="font-bold text-white font-display text-sm truncate pr-4 mt-0.5">{activeViewFile.name}</h3>
              </div>
              <button
                type="button"
                onClick={handleCloseLightbox}
                className="text-slate-400 hover:text-slate-200 transition-colors font-semibold text-xs rounded-lg p-1.5 bg-white/[0.04] border border-white/[0.06] cursor-pointer"
              >
                Close (ESC)
              </button>
            </div>

            <div className="flex-1 bg-black/35 overflow-auto p-6 flex flex-col items-center justify-center min-h-[300px]">
              {isPreviewLoading ? (
                <div className="text-center text-slate-400 space-y-2">
                  <RefreshCw className="w-8 h-8 animate-spin mx-auto text-indigo-400" />
                  <p className="text-xs">Fetching high-res original canvas asset...</p>
                </div>
              ) : viewBlobUrl ? (
                <img
                  src={viewBlobUrl}
                  alt={activeViewFile.name}
                  className="max-w-full max-h-[50vh] object-contain shadow-2xl rounded-xl border border-white/[0.06]"
                />
              ) : (
                <span className="text-slate-500 text-xs text-center">Unloaded source document</span>
              )}
            </div>

            <div className="bg-white/[0.01]/80 px-6 py-4 border-t border-white/[0.06] flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between text-xs">
              <span className="text-slate-400 font-semibold truncate max-w-[280px]">
                Drive File ID: <span className="font-mono bg-black/45 text-indigo-300 border border-white/[0.05] px-2 py-1 rounded select-all">{activeViewFile.id}</span>
              </span>

              <div className="flex gap-2 shrink-0">
                {viewBlobUrl && (
                  <a
                    href={viewBlobUrl}
                    download={activeViewFile.name}
                    className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-4 py-2 bg-gradient-to-r from-indigo-500 to-blue-500 hover:from-indigo-600 hover:to-blue-600 text-white font-bold rounded-xl shadow-md cursor-pointer text-center text-xs transition-all"
                  >
                    <Download className="w-3.5 h-3.5" /> Download JPG
                  </a>
                )}
                <button
                  type="button"
                  onClick={() => handleDeleteMergedCard(activeViewFile)}
                  className="flex-1 sm:flex-initial flex items-center justify-center gap-1.5 px-4 py-2 bg-rose-500/10 border border-rose-500/20 hover:bg-rose-500/20 text-rose-300 hover:text-rose-200 font-bold rounded-xl cursor-pointer text-xs transition-all"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Permanently Delete
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


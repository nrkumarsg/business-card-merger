import React, { useState, useEffect } from "react";
import { Folder, FolderOpen, RefreshCw, FileImage, Layers, Plus, Check, Eye } from "lucide-react";
import { DriveFile, CardPair } from "../types";

interface DriveBrowserProps {
  token: string | null;
  rawFolderId: string;
  mergedFolderId: string;
  rawFiles: DriveFile[];
  isLoading: boolean;
  onRefresh: () => void;
  onAddManualPair: (front: DriveFile, back?: DriveFile) => void;
  onBatchSuggestPairs: (pairs: CardPair[]) => void;
  existingPairs: CardPair[];
}

export default function DriveBrowser({
  token,
  rawFolderId,
  rawFiles,
  isLoading,
  onRefresh,
  onAddManualPair,
  onBatchSuggestPairs,
  existingPairs,
}: DriveBrowserProps) {
  const [selectedFiles, setSelectedFiles] = useState<DriveFile[]>([]);
  const [previewFile, setPreviewFile] = useState<DriveFile | null>(null);
  const [previewBlobUrl, setPreviewBlobUrl] = useState<string | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);

  // Clear preview URL on change
  useEffect(() => {
    return () => {
      if (previewBlobUrl) {
        URL.revokeObjectURL(previewBlobUrl);
      }
    };
  }, [previewBlobUrl]);

  // Load larger preview for side-dialog
  const handleViewPreview = async (file: DriveFile) => {
    setPreviewFile(file);
    if (!token) return;
    setIsLoadingPreview(true);
    setPreviewBlobUrl(null);
    try {
      const { downloadFileAsBlob } = await import("../utils/driveApi");
      const blob = await downloadFileAsBlob(token, file.id);
      const url = URL.createObjectURL(blob);
      setPreviewBlobUrl(url);
    } catch (err) {
      console.error("Preview load err:", err);
    } finally {
      setIsLoadingPreview(false);
    }
  };

  const toggleSelectFile = (file: DriveFile) => {
    if (selectedFiles.some((f) => f.id === file.id)) {
      setSelectedFiles(selectedFiles.filter((f) => f.id !== file.id));
    } else {
      if (selectedFiles.length < 2) {
        setSelectedFiles([...selectedFiles, file]);
      } else {
        // Replace second file, keeping first
        setSelectedFiles([selectedFiles[0], file]);
      }
    }
  };

  // Check if a file is already paired in any existing candidate pairs
  const isFileAlreadyPaired = (fileId: string) => {
    return existingPairs.some(
      (p) => p.frontFile.id === fileId || p.backFile?.id === fileId
    );
  };

  // Suggest front-back alignments for all raw cards in the directory sequentially
  const handleAutoSuggestAll = () => {
    if (rawFiles.length === 0) return;

    // Filter files that are not already associated with a pair
    const unpairedFiles = [...rawFiles]
      .filter((file) => !isFileAlreadyPaired(file.id))
      // Sort alphabetically/numerically so sequential scans align correctly
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));

    const suggested: CardPair[] = [];
    for (let i = 0; i < unpairedFiles.length; i += 2) {
      const front = unpairedFiles[i];
      const back = unpairedFiles[i + 1]; // Can be undefined if odd element

      // Create a suggested card pair structure
      suggested.push({
        id: `suggest-${Date.now()}-${i}`,
        name: back
          ? `Card: ${front.name.replace(/\.[^/.]+$/, "")} + ${back.name.replace(/\.[^/.]+$/, "")}`
          : `Card (Single): ${front.name.replace(/\.[^/.]+$/, "")}`,
        frontFile: front,
        backFile: back,
        status: "idle",
        layout: "horizontal",
        spacerColor: "#ffffff",
        gapSize: 10,
      });
    }

    if (suggested.length > 0) {
      onBatchSuggestPairs(suggested);
      setSelectedFiles([]);
    }
  };

  const handlePairSelected = () => {
    if (selectedFiles.length === 0) return;
    const front = selectedFiles[0];
    const back = selectedFiles[1]; // might be undefined

    onAddManualPair(front, back);
    setSelectedFiles([]);
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Raw Files Explorer Panel */}
      <div className="lg:col-span-2 bg-white/[0.03] backdrop-blur-lg border border-white/[0.08] shadow-[0_8px_32px_0_rgba(0,0,0,0.3)] rounded-2xl p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/[0.06] pb-5 mb-5">
          <div>
            <div className="flex items-center gap-2">
              <FolderOpen className="w-5 h-5 text-indigo-400" />
              <h2 className="text-lg font-semibold text-white font-display">
                1. Scanned Cards Folder
              </h2>
            </div>
            <p className="text-xs text-slate-400 mt-1">
              Currently displaying files inside <strong className="text-indigo-400 font-medium">Raw_Bus_cards</strong> directory
            </p>
          </div>

          <div className="flex gap-2 self-start sm:self-center">
            {rawFiles.length > 0 && (
              <button
                type="button"
                id="btn-auto-pair"
                onClick={handleAutoSuggestAll}
                className="flex items-center gap-2 px-3 py-1.5 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
              >
                <Layers className="w-3.5 h-3.5" />
                Auto-Pair All Scans
              </button>
            )}

            <button
              type="button"
              id="btn-refresh-drive"
              disabled={isLoading}
              onClick={onRefresh}
              className="flex items-center justify-center p-2 text-slate-300 bg-white/[0.04] hover:bg-white/[0.1] disabled:opacity-40 border border-white/[0.08] rounded-lg transition-colors cursor-pointer"
              title="Refresh Files"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-20">
            <RefreshCw className="w-8 h-8 text-indigo-400 animate-spin mb-3" />
            <p className="text-sm text-slate-400">Querying Google Drive files...</p>
          </div>
        ) : rawFiles.length === 0 ? (
          <div className="text-center py-16 border border-dashed border-white/[0.08] rounded-xl bg-white/[0.01]">
            <Folder className="w-10 h-10 text-slate-600 mx-auto mb-3 animate-pulse" />
            <p className="text-sm font-medium text-slate-300 font-display">No raw images found</p>
            <p className="text-xs text-slate-400 mt-2 max-w-sm mx-auto leading-relaxed">
              Add your single front and back card images to the <strong className="font-semibold text-slate-200">Raw_Bus_cards</strong> folder inside Google Drive, then refresh!
            </p>
          </div>
        ) : (
          <div>
            {/* Quick Action Bar for selected items */}
            {selectedFiles.length > 0 && (
              <div className="bg-indigo-500/10 border border-indigo-500/30 text-indigo-200 rounded-xl p-3 mb-4 flex items-center justify-between transition-all">
                <span className="text-xs font-medium">
                  Selected <strong className="font-semibold text-white">{selectedFiles.length}</strong> file(s) for manual card pairing.
                </span>
                <button
                  type="button"
                  id="btn-pair-selected"
                  onClick={handlePairSelected}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-indigo-500 to-blue-500 hover:from-indigo-600 hover:to-blue-600 text-white text-xs font-semibold rounded-lg shadow-md transition-all cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Pair as Card
                </button>
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 max-h-[500px] overflow-y-auto pr-2">
              {rawFiles.map((file) => {
                const isSelected = selectedFiles.some((f) => f.id === file.id);
                const isAlreadyPaired = isFileAlreadyPaired(file.id);

                return (
                  <div
                    key={file.id}
                    className={`relative rounded-xl border flex flex-col p-2.5 group transition-all select-none ${
                      isSelected
                        ? "border-indigo-500 bg-indigo-500/10 shadow-[0_0_15px_rgba(99,102,241,0.2)]"
                        : isAlreadyPaired
                        ? "border-emerald-500/30 bg-emerald-500/5 opacity-60"
                        : "border-white/[0.06] hover:border-white/[0.12] bg-white/[0.01]"
                    }`}
                  >
                    {/* Visual Checkmark / Badge */}
                    <div className="absolute top-2.5 right-2.5 z-10 flex gap-1 items-center">
                      {isAlreadyPaired && (
                        <div className="bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 p-1 rounded-full" title="Already in workspace pair">
                          <Check className="w-2.5 h-2.5" />
                        </div>
                      )}
                      <button
                        type="button"
                        onClick={() => toggleSelectFile(file)}
                        className={`w-5 h-5 rounded-md flex items-center justify-center border transition-all cursor-pointer ${
                          isSelected
                            ? "bg-indigo-500 border-indigo-500 text-white"
                            : "bg-black/30 border-white/[0.12] hover:border-white/[0.25] text-transparent"
                        }`}
                      >
                        <Check className="w-3 h-3 stroke-[3]" />
                      </button>
                    </div>

                    <div className="aspect-[4/3] rounded-lg overflow-hidden bg-black/20 border border-white/[0.04] mb-2.5 relative flex items-center justify-center">
                      {file.thumbnailLink ? (
                        <img
                          src={file.thumbnailLink}
                          alt={file.name}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-200"
                        />
                      ) : (
                        <FileImage className="w-8 h-8 text-slate-600" />
                      )}

                      {/* Hover Overlay preview button */}
                      <div className="absolute inset-0 bg-slate-950/60 opacity-0 group-hover:opacity-100 flex items-center justify-center gap-2 transition-opacity">
                        <button
                          type="button"
                          onClick={() => handleViewPreview(file)}
                          className="p-1.5 bg-white text-slate-900 hover:bg-slate-100 rounded-lg shadow-md transition-colors text-xs flex items-center gap-1 cursor-pointer font-semibold"
                        >
                          <Eye className="w-3" /> Preview
                        </button>
                      </div>
                    </div>

                    <div className="truncate">
                      <p className="text-xs font-semibold text-slate-200 truncate" title={file.name}>
                        {file.name}
                      </p>
                      <p className="text-[10px] text-slate-500 mt-1">
                        {file.createdTime ? new Date(file.createdTime).toLocaleDateString() : ""}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Preview Sheet Panel (Right Column) */}
      <div className="bg-white/[0.02] border border-white/[0.08] backdrop-blur-md rounded-2xl p-6 flex flex-col h-full self-start shadow-[0_8px_32px_0_rgba(0,0,0,0.3)]">
        <h3 className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest mb-4">
          Scan File details
        </h3>

        {previewFile ? (
          <div className="flex flex-col flex-1">
            <div className="aspect-[3/2] rounded-xl overflow-hidden bg-black/20 border border-white/[0.04] mb-4 flex items-center justify-center relative">
              {isLoadingPreview ? (
                <div className="flex flex-col items-center">
                  <RefreshCw className="w-6 h-6 text-slate-500 animate-spin mb-2" />
                  <span className="text-xs text-slate-500">Loading high-res image...</span>
                </div>
              ) : previewBlobUrl ? (
                <img
                  src={previewBlobUrl}
                  alt={previewFile.name}
                  className="w-full h-full object-contain"
                />
              ) : (
                <div className="text-center p-4">
                  <FileImage className="w-10 h-10 text-slate-600 mx-auto mb-2" />
                  <span className="text-xs text-slate-500">No full preview loaded</span>
                </div>
              )}
            </div>

            <div className="space-y-3 bg-white/[0.02] border border-white/[0.06] p-4 rounded-xl text-xs">
              <div>
                <span className="text-[9px] text-slate-500 uppercase tracking-wider font-semibold">File Name</span>
                <p className="font-semibold text-slate-200 break-all">{previewFile.name}</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <span className="text-[9px] text-slate-500 uppercase tracking-wider font-semibold">Created Date</span>
                  <p className="font-semibold text-slate-300">
                    {previewFile.createdTime ? new Date(previewFile.createdTime).toLocaleDateString() : "Unknown"}
                  </p>
                </div>
                <div>
                  <span className="text-[9px] text-slate-500 uppercase tracking-wider font-semibold">Extension</span>
                  <p className="font-semibold text-slate-300 uppercase">
                    {previewFile.mimeType.split("/")[1] || "JPEG"}
                  </p>
                </div>
              </div>
              <div>
                <span className="text-[9px] text-slate-500 uppercase tracking-wider font-semibold">Google Drive File ID</span>
                <p className="font-mono text-[9px] text-indigo-300 bg-black/35 border border-white/[0.04] p-2 rounded truncate select-all">
                  {previewFile.id}
                </p>
              </div>
            </div>

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={() => {
                  onAddManualPair(previewFile);
                  setSelectedFiles([]);
                }}
                className="flex-1 py-2.5 bg-gradient-to-r from-indigo-500 to-blue-500 hover:from-indigo-600 hover:to-blue-600 active:scale-[0.98] text-white font-bold text-xs rounded-xl shadow-md transition-all cursor-pointer text-center"
              >
                Use as Front Card
              </button>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center border border-dashed border-white/[0.06] rounded-xl py-12 px-3 text-center text-slate-400 bg-white/[0.01]">
            <FileImage className="w-10 h-10 text-slate-600 mb-3 animate-pulse" />
            <p className="text-xs max-w-xs px-2 leading-relaxed">
              Hover over an image on the left and click its <strong>Preview</strong> button to view detail specs and high-resolution inspect metrics here.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

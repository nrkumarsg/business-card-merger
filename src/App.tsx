import React, { useState, useEffect } from "react";
import { User } from "firebase/auth";
import {
  Sparkles,
  Layers,
  FolderOpen,
  FolderHeart,
  Users,
  LogOut,
  RefreshCw,
  Folder,
  Download,
  Mail,
  Phone,
  Globe,
  MapPin,
  FileSpreadsheet,
} from "lucide-react";
import { initAuth, googleSignIn, logoutUser } from "./firebase";
import { DriveFile, CardPair, ParsedCard } from "./types";
import { findOrCreateFolder, listFilesByFolder, listGoogleContacts } from "./utils/driveApi";
import DriveBrowser from "./components/DriveBrowser";
import CardMerger from "./components/CardMerger";
import MergedCollection from "./components/MergedCollection";

export default function App() {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [needsAuth, setNeedsAuth] = useState(true);
  const [isInitializing, setIsInitializing] = useState(true);

  // Folder IDs state
  const [rawFolderId, setRawFolderId] = useState<string>("");
  const [mergedFolderId, setMergedFolderId] = useState<string>("");
  const [isProvisioning, setIsProvisioning] = useState(false);

  // Files & Queue state
  const [rawFiles, setRawFiles] = useState<DriveFile[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [queuePairs, setQueuePairs] = useState<CardPair[]>([]);

  // Synchronised CRM Contacts list
  const [syncedContacts, setSyncedContacts] = useState<ParsedCard[]>([]);
  const [isLoadingContacts, setIsLoadingContacts] = useState(false);

  // Local saved parsing history session
  const [localParseHistory, setLocalParseHistory] = useState<{ cardId: string; contact: ParsedCard }[]>([]);

  // Active workspace tab view
  const [activeTab, setActiveTab] = useState<"workspace" | "explorer" | "gallery" | "contacts">("workspace");

  // Single detail parser state overlay triggers from collection
  const [activeParserContact, setActiveParserContact] = useState<ParsedCard | null>(null);
  const [activeParserId, setActiveParserId] = useState<string | null>(null);

  // Initialize Authentication State on page load
  useEffect(() => {
    const unsubscribe = initAuth(
      (currentUser, accessToken) => {
        setUser(currentUser);
        setToken(accessToken);
        setNeedsAuth(false);
        setIsInitializing(false);
      },
      () => {
        setUser(null);
        setToken(null);
        setNeedsAuth(true);
        setIsInitializing(false);
      }
    );
    return () => unsubscribe();
  }, []);

  // Sync / Discover foldering systems on successful authentication
  useEffect(() => {
    if (token) {
      syncGoogleFolders();
    }
  }, [token]);

  const handleSignIn = async () => {
    setIsInitializing(true);
    try {
      const result = await googleSignIn();
      if (result) {
        setToken(result.accessToken);
        setUser(result.user);
        setNeedsAuth(false);
      }
    } catch (err) {
      console.error("Sign-in process aborted or blocked:", err);
    } finally {
      setIsInitializing(false);
    }
  };

  const handleSignOut = async () => {
    await logoutUser();
    // Flush all states
    setToken(null);
    setUser(null);
    setRawFolderId("");
    setMergedFolderId("");
    setRawFiles([]);
    setQueuePairs([]);
    setSyncedContacts([]);
    setLocalParseHistory([]);
    setNeedsAuth(true);
    setActiveTab("workspace");
  };

  // Automated discovery / creation of specified corporate repositories
  const syncGoogleFolders = async () => {
    if (!token) return;
    setIsProvisioning(true);
    try {
      // Find or create "Raw_Bus_cards" folder
      const rawId = await findOrCreateFolder(token, "Raw_Bus_cards");
      setRawFolderId(rawId);

      // Find or create "Merged_Bus_Cards" folder
      const mergedId = await findOrCreateFolder(token, "Merged_Bus_Cards");
      setMergedFolderId(mergedId);

      // Fetch files immediately
      await loadRawFiles(rawId);
      await loadContactsList();
    } catch (err) {
      console.error("Folder structure setup integration error:", err);
    } finally {
      setIsProvisioning(false);
    }
  };

  const loadRawFiles = async (folderId: string) => {
    if (!token || !folderId) return;
    setIsLoadingFiles(true);
    try {
      const files = await listFilesByFolder(token, folderId);
      setRawFiles(files);
    } catch (err) {
      console.error("Failed to load raw scans:", err);
    } finally {
      setIsLoadingFiles(false);
    }
  };

  const loadContactsList = async () => {
    if (!token) return;
    setIsLoadingContacts(true);
    try {
      const list = await listGoogleContacts(token);
      setSyncedContacts(list);
    } catch (err) {
      console.error("Contacts pull err:", err);
    } finally {
      setIsLoadingContacts(false);
    }
  };

  // Add a manual / click-selected card pair into the queue
  const handleAddManualPair = (front: DriveFile, back?: DriveFile) => {
    // Check if front card is already paired
    if (queuePairs.some((p) => p.frontFile.id === front.id || p.backFile?.id === front.id)) {
      alert("This image is already included in a card pair inside the queue!");
      return;
    }
    if (back && queuePairs.some((p) => p.frontFile.id === back.id || p.backFile?.id === back.id)) {
      alert("The selected back image is already in use inside another card pair!");
      return;
    }

    const newPair: CardPair = {
      id: `manual-${Date.now()}`,
      name: back ? `Manual Card: ${front.name} + ${back.name}` : `Manual Card (Single Side): ${front.name}`,
      frontFile: front,
      backFile: back,
      status: "idle",
      layout: "horizontal",
      spacerColor: "#ffffff",
      gapSize: 10,
    };

    setQueuePairs([...queuePairs, newPair]);
    setActiveTab("workspace");
  };

  // Triggered when auto-generating suggestions bulk-packs
  const handleBatchSuggestPairs = (suggested: CardPair[]) => {
    setQueuePairs([...queuePairs, ...suggested]);
    setActiveTab("workspace");
  };

  const handleUpdatePair = (updated: CardPair) => {
    setQueuePairs(queuePairs.map((p) => (p.id === updated.id ? updated : p)));
  };

  const handleRemovePair = (id: string) => {
    setQueuePairs(queuePairs.filter((p) => p.id !== id));
  };

  const handleClearAllPairs = () => {
    if (window.confirm("Are you sure you want to discard your entire active workspace queue?")) {
      setQueuePairs([]);
    }
  };

  const handleAddContactToSaved = (contact: ParsedCard, cardId: string) => {
    setLocalParseHistory((prev) => [{ cardId, contact }, ...prev]);
    // Also re-trigger contacts download
    loadContactsList();
  };

  const handleOpenAiSheetFromCollection = (contact: ParsedCard, cardId: string) => {
    setActiveParserContact(contact);
    setActiveParserId(cardId);
    setActiveTab("workspace");
  };

  // Export full CRM synced list to single CSV document for download
  const handleExportContactsToCsv = () => {
    if (syncedContacts.length === 0) return;

    const headers = ["Name", "Company", "Job Title", "Emails", "Phone Numbers", "Websites", "Address", "Notes"];
    const rows = syncedContacts.map((c) => [
      c.name,
      c.company,
      c.title,
      c.emails.join("; "),
      c.phones.join("; "),
      c.websites.join("; "),
      c.address.replace(/\n/g, " "),
      c.notes.replace(/\n/g, " "),
    ]);

    const csvContent =
      "data:text/csv;charset=utf-8," +
      [headers.join(","), ...rows.map((e) => e.map((val) => `"${val.replace(/"/g, '""')}"`).join(","))].join("\n");

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Google_Contacts_Export_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (isInitializing) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#070a13] text-white font-sans relative overflow-hidden">
        {/* Floating glow spheres */}
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-indigo-600/15 blur-[120px] pointer-events-none" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-blue-600/15 blur-[120px] pointer-events-none" />
        
        <div className="relative z-10 text-center flex flex-col items-center space-y-3">
          <RefreshCw className="w-10 h-10 text-indigo-400 animate-spin mb-2" />
          <h2 className="text-lg font-bold font-display tracking-tight text-white">Opening Workspace...</h2>
          <p className="text-[11px] text-slate-400 max-w-xs">Connecting API tunnels & synchronizing session security</p>
        </div>
      </div>
    );
  }

  // Pre-Authentication Splash screen
  if (needsAuth) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-[#070a13] text-slate-100 font-sans p-6 relative overflow-hidden">
        {/* Floating backdrop blur design elements */}
        <div className="absolute top-[-15%] left-[-10%] w-[50%] h-[50%] rounded-full bg-indigo-600/20 blur-[130px] pointer-events-none" />
        <div className="absolute bottom-[-15%] right-[-10%] w-[60%] h-[60%] rounded-full bg-blue-600/20 blur-[150px] pointer-events-none" />
        <div className="absolute top-[35%] left-[25%] w-[40%] h-[40%] rounded-full bg-purple-600/10 blur-[120px] pointer-events-none" />

        <div className="relative z-10 max-w-md w-full bg-white/[0.03] backdrop-blur-xl rounded-3xl p-8 text-center border border-white/[0.08] shadow-[0_8px_32px_0_rgba(0,0,0,0.37)] space-y-6">
          <div className="mx-auto w-14 h-14 bg-gradient-to-tr from-indigo-500 to-blue-500 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-indigo-500/20">
            <Sparkles className="w-7 h-7" />
          </div>

          <div className="space-y-2">
            <h1 className="text-2xl font-bold font-display text-white tracking-tight">
              Business Card Merger & AI Parser
            </h1>
            <p className="text-xs text-slate-300 leading-relaxed">
              Organize multiple business card scans sequentially from Google Drive. Seamlessly stitch front & back sides on a dynamic, adjustable Canvas, parse them with Gemini AI, and sync coordinate cards into Google Contacts CRM.
            </p>
          </div>

          <div className="border-t border-white/[0.06] pt-6">
            <button
              onClick={handleSignIn}
              id="btn-google-login"
              className="w-full flex items-center justify-center gap-3 py-3 bg-gradient-to-r from-indigo-500 to-blue-500 hover:from-indigo-600 hover:to-blue-600 active:scale-[0.99] text-white font-bold text-xs rounded-xl shadow-[0_4px_20px_rgba(99,102,241,0.25)] hover:shadow-[0_4px_25px_rgba(99,102,241,0.4)] transition-all cursor-pointer"
            >
              <svg className="w-4 h-4 fill-current" viewBox="0 0 24 24">
                <path d="M12.24 10.285V14.4h6.887c-.648 2.41-2.519 4.114-5.136 4.114-3.478 0-6.3-2.823-6.3-6.3s2.822-6.3 6.3-6.3c1.554 0 2.97.568 4.072 1.503l3.078-3.078C18.67 1.944 15.655 1 12.24 1 6.033 1 1 6.033 1 12.24s5.033 11.24 11.24 11.24c5.899 0 10.74-4.258 10.74-10.74 0-.648-.057-1.285-.171-1.928H12.24z" />
              </svg>
              Connect with Google Workspace
            </button>
            <p className="text-[10px] text-slate-400 mt-4 leading-normal">
              Connecting grants temporary OAuth permission to Google Drive (reading card collections) and Google Contacts (saving finalized CRM results).
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#070a13] text-slate-100 font-sans flex flex-col relative overflow-hidden">
      {/* Background glowing gradients */}
      <div className="absolute top-[-10%] left-[-10%] w-[45%] h-[45%] rounded-full bg-indigo-600/10 blur-[130px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[55%] h-[55%] rounded-full bg-blue-600/10 blur-[160px] pointer-events-none" />
      <div className="absolute top-[40%] left-[30%] w-[30%] h-[30%] rounded-full bg-purple-600/5 blur-[100px] pointer-events-none" />

      {/* Dynamic Header */}
      <header className="bg-white/[0.02] backdrop-blur-xl border-b border-white/[0.08] px-6 py-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4 sticky top-0 z-40 shadow-sm relative">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-tr from-indigo-500 to-blue-500 rounded-xl flex items-center justify-center text-white shadow-md shrink-0">
            <Sparkles className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-sm md:text-base font-bold font-display text-white tracking-tight leading-none">
              Business Card Merger & AI Parser
            </h1>
            {isProvisioning ? (
              <span className="text-[9px] text-amber-400 font-semibold animate-pulse flex items-center gap-1 mt-1.5">
                <RefreshCw className="w-2.5 h-2.5 animate-spin" /> Provisioning Drive system folders...
              </span>
            ) : (
              <p className="text-[10px] text-slate-400 mt-1 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></span>
                Connected as <strong className="text-slate-200 font-semibold">{user?.email}</strong>
              </p>
            )}
          </div>
        </div>

        {/* Global tab views */}
        <div className="flex flex-wrap items-center gap-1 bg-white/[0.03] p-1 rounded-xl border border-white/[0.06] self-start lg:self-center">
          <button
            type="button"
            id="tab-workspace"
            onClick={() => setActiveTab("workspace")}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === "workspace"
                ? "bg-white/[0.08] text-white border border-white/[0.12] shadow-sm font-bold"
                : "text-slate-400 hover:text-slate-200 hover:bg-white/[0.02] border border-transparent"
            }`}
          >
            <Layers className="w-3.5 h-3.5" /> Workspace Stand
          </button>
          <button
            type="button"
            id="tab-explorer"
            onClick={() => setActiveTab("explorer")}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === "explorer"
                ? "bg-white/[0.08] text-white border border-white/[0.12] shadow-sm font-bold"
                : "text-slate-400 hover:text-slate-200 hover:bg-white/[0.02] border border-transparent"
            }`}
          >
            <FolderOpen className="w-3.5 h-3.5" /> Scanned Scans
          </button>
          <button
            type="button"
            id="tab-gallery"
            onClick={() => setActiveTab("gallery")}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === "gallery"
                ? "bg-white/[0.08] text-white border border-white/[0.12] shadow-sm font-bold"
                : "text-slate-400 hover:text-slate-200 hover:bg-white/[0.02] border border-transparent"
            }`}
          >
            <FolderHeart className="w-3.5 h-3.5" /> Merged Depot
          </button>
          <button
            type="button"
            id="tab-contacts"
            onClick={() => setActiveTab("contacts")}
            className={`px-3.5 py-1.5 text-xs font-semibold rounded-lg transition-all cursor-pointer flex items-center gap-1.5 ${
              activeTab === "contacts"
                ? "bg-white/[0.08] text-white border border-white/[0.12] shadow-sm font-bold"
                : "text-slate-400 hover:text-slate-200 hover:bg-white/[0.02] border border-transparent"
            }`}
          >
            <Users className="w-3.5 h-3.5" /> Synced contacts
          </button>
        </div>

        <button
          type="button"
          onClick={handleSignOut}
          id="btn-logout"
          className="flex items-center justify-center p-2.5 text-slate-400 hover:text-rose-400 border border-white/[0.06] hover:border-rose-500/20 bg-white/[0.02] hover:bg-rose-500/10 rounded-xl transition-all cursor-pointer self-start lg:self-auto"
          title="Disconnect Google Account"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </header>

      {/* Main app windows */}
      <main className="flex-1 p-6 max-w-7xl w-full mx-auto relative z-10">
        {activeTab === "workspace" && (
          <div className="space-y-6">
            <CardMerger
              token={token!}
              pairs={queuePairs}
              mergedFolderId={mergedFolderId}
              onUpdatePair={handleUpdatePair}
              onRemovePair={handleRemovePair}
              onClearAll={handleClearAllPairs}
              onAddContactToSaved={handleAddContactToSaved}
            />

            {/* In-App Drive quick picker footer inside Workspace tab if queue is low */}
            {queuePairs.length === 0 && (
              <div className="pt-6 border-t border-white/[0.06]">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-[10px] uppercase font-bold tracking-widest text-indigo-400">
                    Fast Scanner Loader & Manual Pairing Drawer
                  </h4>
                  <button
                    type="button"
                    onClick={() => setActiveTab("explorer")}
                    className="text-indigo-400 hover:text-indigo-300 text-xs font-semibold transition-colors"
                  >
                    Manage Folders Explorer &rarr;
                  </button>
                </div>
                <DriveBrowser
                  token={token}
                  rawFolderId={rawFolderId}
                  mergedFolderId={mergedFolderId}
                  rawFiles={rawFiles}
                  isLoading={isLoadingFiles}
                  onRefresh={() => loadRawFiles(rawFolderId)}
                  onAddManualPair={handleAddManualPair}
                  onBatchSuggestPairs={handleBatchSuggestPairs}
                  existingPairs={queuePairs}
                />
              </div>
            )}
          </div>
        )}

        {activeTab === "explorer" && (
          <DriveBrowser
            token={token}
            rawFolderId={rawFolderId}
            mergedFolderId={mergedFolderId}
            rawFiles={rawFiles}
            isLoading={isLoadingFiles}
            onRefresh={() => loadRawFiles(rawFolderId)}
            onAddManualPair={handleAddManualPair}
            onBatchSuggestPairs={handleBatchSuggestPairs}
            existingPairs={queuePairs}
          />
        )}

        {activeTab === "gallery" && (
          <MergedCollection
            token={token}
            mergedFolderId={mergedFolderId}
            isLoading={isLoadingFiles}
            onRefresh={() => loadRawFiles(rawFolderId)}
            onAddContactToSaved={handleAddContactToSaved}
            onOpenAiSheet={handleOpenAiSheetFromCollection}
          />
        )}

        {activeTab === "contacts" && (
          <div className="bg-white/[0.03] backdrop-blur-lg border border-white/[0.08] shadow-[0_8px_32px_0_rgba(0,0,0,0.3)] rounded-2xl p-6 space-y-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/[0.06] pb-5">
              <div>
                <div className="flex items-center gap-2">
                  <Users className="w-5 h-5 text-indigo-400" />
                  <h2 className="text-lg font-semibold text-white font-display">
                    Synced CRM Google Contacts
                  </h2>
                </div>
                <p className="text-xs text-slate-400 mt-1">
                  Search or browse card coordinates safely written to your Google account repository.
                </p>
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleExportContactsToCsv}
                  disabled={syncedContacts.length === 0}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-white/[0.05] hover:bg-white/[0.12] border border-white/[0.08] text-slate-200 disabled:opacity-40 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                >
                  <FileSpreadsheet className="w-3.5 h-3.5" /> Export CRM List
                </button>
                <button
                  type="button"
                  disabled={isLoadingContacts}
                  onClick={loadContactsList}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-500/10 hover:bg-indigo-500/20 border border-indigo-500/25 text-indigo-300 text-xs font-semibold rounded-lg transition-colors cursor-pointer"
                >
                  <RefreshCw className={`w-3 h-3 ${isLoadingContacts ? "animate-spin" : ""}`} /> Sync CRM
                </button>
              </div>
            </div>

            {isLoadingContacts ? (
              <div className="flex flex-col items-center justify-center py-20 pb-24">
                <RefreshCw className="w-8 h-8 text-indigo-400 animate-spin mb-3" />
                <p className="text-xs text-slate-400">Loading contacts list from Google Account...</p>
              </div>
            ) : syncedContacts.length === 0 ? (
              <div className="text-center py-20 border-2 border-dashed border-white/[0.05] rounded-2xl">
                <Users className="w-12 h-12 text-slate-600 mx-auto mb-3 animate-pulse" />
                <h4 className="text-sm font-semibold text-slate-300 font-display">No synchronized profile cards found</h4>
                <p className="text-xs text-slate-400 mt-2 max-w-sm mx-auto leading-relaxed">
                  Start scanning files inside your folder explorer, assemble cards in workspace stand, and run the <strong>AI Parser</strong> to upload and synchronize profiles.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-h-[600px] overflow-y-auto pr-2">
                {syncedContacts.map((contact, index) => (
                  <div
                    key={index}
                    className="p-5 bg-white/[0.02] border border-white/[0.06] rounded-2xl hover:border-white/[0.12] hover:bg-white/[0.04] transition-all text-xs space-y-4"
                  >
                    <div>
                      <h4 className="font-bold text-sm text-white tracking-tight leading-tight">
                        {contact.name || "Unnamed Contact"}
                      </h4>
                      {(contact.title || contact.company) && (
                        <p className="text-[10px] text-indigo-300 mt-1.5 font-semibold uppercase tracking-wider">
                          {contact.title} {contact.title && contact.company ? "at" : ""}{" "}
                          <span className="text-white font-bold">{contact.company}</span>
                        </p>
                      )}
                    </div>

                    <div className="space-y-2.5 border-t border-white/[0.05] pt-3.5">
                      {contact.emails.length > 0 && (
                        <div className="flex items-center gap-2 text-slate-300">
                          <Mail className="w-3.5 h-3.5 text-slate-500" />
                          <span className="truncate" title={contact.emails.join(", ")}>
                            {contact.emails[0]}
                          </span>
                        </div>
                      )}

                      {contact.phones.length > 0 && (
                        <div className="flex items-center gap-2 text-slate-300">
                          <Phone className="w-3.5 h-3.5 text-slate-500" />
                          <span>{contact.phones[0]}</span>
                        </div>
                      )}

                      {contact.websites.length > 0 && (
                        <div className="flex items-center gap-2 text-slate-300">
                          <Globe className="w-3.5 h-3.5 text-slate-500" />
                          <span className="truncate text-indigo-400 hover:underline">
                            <a href={contact.websites[0]} target="_blank" rel="noreferrer">
                              {contact.websites[0]}
                            </a>
                          </span>
                        </div>
                      )}

                      {contact.address && (
                        <div className="flex items-start gap-2 text-slate-300">
                          <MapPin className="w-3.5 h-3.5 text-slate-500 mt-0.5" />
                          <span className="leading-snug">{contact.address}</span>
                        </div>
                      )}
                    </div>

                    {contact.notes && (
                      <div className="bg-black/25 p-2.5 text-[10px] font-medium rounded-lg text-slate-400 leading-relaxed border border-white/[0.04]">
                        <strong className="text-indigo-400">AI Category Insight:</strong> {contact.notes}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}

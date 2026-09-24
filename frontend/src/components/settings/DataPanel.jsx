/**
 * Export and import, as a tab of their own.
 *
 * The prototype has no Data tab and never designed either operation -- the word
 * backup appears in it once, as the name of an example token. Both work today,
 * so this keeps them rather than folding them into Account, which would
 * otherwise hold email, password, sign out, two preferences, export and import.
 */
import { useRef, useState } from "react";
import { ChevronDown, ChevronRight, Download, Loader2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { segmentClass } from "@/components/ui/segmented-control";
import { useToast } from "@/components/ui/use-toast";
import { exportData, importData } from "@/lib/api.js";

/**
 * `advanced` is the Server panel, passed in by the dialog: which instance the
 * app talks to is set once if ever, so it sits here collapsed rather than as a
 * tab of its own.
 */
export function DataPanel({ advanced = null, advancedOpen = false, onAdvancedOpenChange } = {}) {
  const { toast } = useToast();

  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  // Merge by default: it is the one that cannot lose anything. Replace is the
  // most destructive action in the app, so it asks once more after the file is
  // chosen, naming the file, rather than firing the moment the picker closes.
  const [importMode, setImportMode] = useState("merge");
  const [pendingFile, setPendingFile] = useState(null);
  // A ref rather than getElementById: two dialogs on one page would both have
  // answered to that id.
  const fileInput = useRef(null);

  const handleExport = async () => {
    setExporting(true);
    try {
      const result = await exportData();
      toast({
        title: "Export complete",
        description: `Downloaded ${result.filename}`,
        variant: "success",
      });
    } catch (error) {
      toast({
        title: "Export failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  };

  const runImport = async (file) => {
    setImporting(true);
    try {
      const result = await importData(file, importMode);
      toast({
        title: importMode === "merge" ? "Merge complete" : "Import complete",
        description: `${result.imported_files?.length || 0} files ${
          importMode === "merge" ? "merged" : "imported"
        }`,
        variant: "success",
      });
    } catch (error) {
      toast({
        title: "Import failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setImporting(false);
      setPendingFile(null);
    }
  };

  const handleFileChosen = (e) => {
    const file = e.target.files?.[0];
    // Choosing the same file twice in a row fires no change event otherwise.
    e.target.value = "";
    if (!file) return;
    if (importMode === "replace") setPendingFile(file);
    else runImport(file);
  };

  return (
    <div className="space-y-4">
      <div className="divide-y rounded-lg border">
        <div className="flex items-center justify-between gap-3 p-3">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">Export backup</p>
            <p className="text-xs text-muted-foreground">
              Download everything as a zip.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={exporting || importing}
            className="shrink-0"
          >
            {exporting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <>
                <Download className="mr-2 h-4 w-4" />
                Export
              </>
            )}
          </Button>
        </div>
        <div className="space-y-3 p-3">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">Import backup</p>
            <p className="text-xs text-muted-foreground">
              Restore from a backup zip. A safety backup is made first.
            </p>
          </div>

          <div
            role="group"
            aria-labelledby="import-mode-label"
            className="space-y-2"
          >
            <p id="import-mode-label" className="text-xs font-medium">
              How to import
            </p>
            <div className="flex rounded-lg bg-muted p-0.5">
              {[
                ["merge", "Merge"],
                ["replace", "Replace"],
              ].map(([mode, label]) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={importMode === mode}
                  onClick={() => {
                    setImportMode(mode);
                    setPendingFile(null);
                  }}
                  className={segmentClass(importMode === mode, false)}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              {importMode === "merge"
                ? "Merge adds the backup to what you already have."
                : "Replace overwrites your current persona with the backup."}
            </p>
          </div>

          {pendingFile ? (
            <div className="space-y-2 rounded-lg border border-destructive/40 p-3">
              <p className="text-sm">
                Replace your persona with <strong>{pendingFile.name}</strong>? Your
                current data is backed up first.
              </p>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => runImport(pendingFile)}
                  disabled={importing}
                >
                  {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : "Replace"}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setPendingFile(null)}
                  disabled={importing}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInput.current?.click()}
              disabled={exporting || importing}
            >
              {importing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Choose file
                </>
              )}
            </Button>
          )}
          <input
            ref={fileInput}
            data-testid="import-file"
            type="file"
            accept=".zip"
            onChange={handleFileChosen}
            className="hidden"
          />
        </div>
      </div>

      {advanced && (
        <div className="border-t pt-4">
          <button
            type="button"
            aria-expanded={advancedOpen}
            onClick={() => onAdvancedOpenChange?.(!advancedOpen)}
            className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
          >
            {advancedOpen ? (
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            ) : (
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            )}
            Advanced: server
          </button>
          {advancedOpen && <div className="mt-3">{advanced}</div>}
        </div>
      )}
    </div>
  );
}

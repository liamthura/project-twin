/**
 * Export and import, as a tab of their own.
 *
 * The prototype has no Data tab and never designed either operation -- the word
 * backup appears in it once, as the name of an example token. Both work today,
 * so this keeps them rather than folding them into Account, which would
 * otherwise hold email, password, sign out, two preferences, export and import.
 */
import { useRef, useState } from "react";
import { Download, Loader2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { segmentClass } from "@/components/ui/segmented-control";
import { useToast } from "@/components/ui/use-toast";
import { exportData, importData } from "@/lib/api.js";

export function DataPanel() {
  const { toast } = useToast();

  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importMode, setImportMode] = useState("replace");
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

  const handleImport = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

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
      // Choosing the same file twice in a row fires no change event otherwise.
      e.target.value = "";
    }
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
        <div className="flex items-center justify-between gap-3 p-3">
          <div className="space-y-0.5">
            <p className="text-sm font-medium">Import backup</p>
            <p className="text-xs text-muted-foreground">
              Restore from a backup zip. A safety backup is made first.
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fileInput.current?.click()}
            disabled={exporting || importing}
            className="shrink-0"
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
          <input
            ref={fileInput}
            data-testid="import-file"
            type="file"
            accept=".zip"
            onChange={handleImport}
            className="hidden"
          />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Import mode</Label>
        <div className="flex rounded-lg bg-muted p-0.5">
          <button
            type="button"
            onClick={() => setImportMode("replace")}
            className={segmentClass(importMode === "replace", false)}
          >
            Replace
          </button>
          <button
            type="button"
            onClick={() => setImportMode("merge")}
            className={segmentClass(importMode === "merge", false)}
          >
            Merge
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          {importMode === "replace"
            ? "Replace overwrites your existing data with the backup's contents."
            : "Merge combines the backup with your existing data."}
        </p>
      </div>
    </div>
  );
}

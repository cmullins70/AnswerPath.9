import { useCallback, useState } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, HelpCircle } from "lucide-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function DocumentUpload() {
  const [uploadProgress, setUploadProgress] = useState(0);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const uploadMutation = useMutation({
    mutationFn: async (files: File[]) => {
      const formData = new FormData();
      files.forEach((file) => formData.append("files", file));

      const response = await fetch("/api/documents/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error("Upload failed");
      }

      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/documents"] });
      toast({
        title: "Success",
        description: "Documents uploaded successfully",
      });
      setUploadProgress(0);
    },
    onError: (error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
      setUploadProgress(0);
    },
  });

  const onDrop = useCallback((acceptedFiles: File[]) => {
    uploadMutation.mutate(acceptedFiles);
  }, [uploadMutation]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'application/msword': ['.doc'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'application/vnd.ms-excel': ['.xls'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx']
    }
  });

  return (
    <div>
      <div
        {...getRootProps()}
        className={cn(
          "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors",
          isDragActive ? "border-primary bg-primary/5" : "border-border"
        )}
      >
        <input {...getInputProps()} />
        <Upload className="mx-auto h-12 w-12 text-muted-foreground" />
        <p className="mt-2 text-sm text-muted-foreground">
          Drag & drop RFI documents here, or click to select files
        </p>
        <div className="flex items-center justify-center gap-1 mt-1">
          <p className="text-xs text-muted-foreground">
            Supported formats: PDF, DOC, DOCX, XLS, XLSX
          </p>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <HelpCircle className="h-4 w-4 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent>
                <p>We support all common document formats used in RFI responses.</p>
                <p>All files are processed securely and confidentially.</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        <ul className="mt-4 text-xs text-muted-foreground list-disc list-inside space-y-1">
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <li>Maximum file size: 10MB per file</li>
              </TooltipTrigger>
              <TooltipContent>
                <p>Large files are automatically optimized for processing</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <li>Files will be processed to extract questions and requirements</li>
              </TooltipTrigger>
              <TooltipContent>
                <p>Our AI system identifies both explicit and implicit questions</p>
                <p>Requirements are automatically categorized for easy response</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <li>Processing may take a few minutes depending on file size</li>
              </TooltipTrigger>
              <TooltipContent>
                <p>Complex documents are analyzed thoroughly for accuracy</p>
                <p>Progress is tracked in real-time</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </ul>
      </div>

      {uploadProgress > 0 && (
        <div className="mt-4">
          <Progress value={uploadProgress} />
          <p className="text-sm text-muted-foreground mt-2">
            Uploading... {uploadProgress}%
          </p>
        </div>
      )}

      <div className="mt-4 flex justify-end">
        <Button
          disabled={uploadMutation.isPending}
          onClick={() => document.querySelector('input')?.click()}
        >
          Select Files
        </Button>
      </div>
    </div>
  );
}
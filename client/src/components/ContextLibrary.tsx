import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Library, Trash2, Globe, File, Upload } from "lucide-react";
import { useDropzone } from "react-dropzone";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

type ContextType = {
  id: number;
  title: string;
  content: string;
  type: 'knowledge_base' | 'website' | 'document';
  createdAt: string;
};

export function ContextLibrary() {
  const [isOpen, setIsOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [type, setType] = useState<ContextType["type"]>("knowledge_base");
  const [url, setUrl] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    if (acceptedFiles.length === 0) return;
    
    const file = acceptedFiles[0];
    const formData = new FormData();
    formData.append("file", file);
    
    try {
      setUploadProgress(10);
      const response = await fetch("/api/contexts/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(error || "Failed to upload document");
      }

      const result = await response.json();
      queryClient.invalidateQueries({ queryKey: ["/api/contexts"] });
      setIsOpen(false);
      setUploadProgress(0);
      toast({
        title: "Success",
        description: "Document uploaded successfully",
      });
    } catch (error) {
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to upload document",
        variant: "destructive",
      });
      setUploadProgress(0);
    }
  }, [queryClient, toast, setIsOpen]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'application/pdf': ['.pdf'],
      'application/msword': ['.doc'],
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
      'application/vnd.ms-excel': ['.xls'],
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx']
    },
    maxFiles: 1,
    multiple: false
  });

  const { data: contexts, isLoading } = useQuery<ContextType[]>({
    queryKey: ["/api/contexts"],
  });

  const createMutation = useMutation({
    mutationFn: async (newContext: Omit<ContextType, "id" | "createdAt">) => {
      const response = await fetch("/api/contexts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newContext),
      });
      if (!response.ok) throw new Error("Failed to create context");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contexts"] });
      setIsOpen(false);
      setTitle("");
      setContent("");
      setType("knowledge_base");
      toast({
        title: "Success",
        description: "Context added successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await fetch(`/api/contexts/${id}`, {
        method: "DELETE",
      });
      if (!response.ok) throw new Error("Failed to delete context");
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contexts"] });
      toast({
        title: "Success",
        description: "Context deleted successfully",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast({
        title: "Error",
        description: "Please fill in all fields",
        variant: "destructive",
      });
      return;
    }

    if (type === "website") {
      if (!url) {
        toast({
          title: "Error",
          description: "Please enter a URL for website content",
          variant: "destructive",
        });
        return;
      }
      
      const response = await fetch("/api/contexts/scrape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      
      if (!response.ok) {
        const error = await response.text();
        toast({
          title: "Error",
          description: error || "Failed to scrape website",
          variant: "destructive",
        });
        return;
      }
      
      queryClient.invalidateQueries({ queryKey: ["/api/contexts"] });
      setIsOpen(false);
      setUrl("");
    } else {
      if (!content.trim()) {
        toast({
          title: "Error",
          description: "Please fill in all fields",
          variant: "destructive",
        });
        return;
      }
      createMutation.mutate({ title, content, type });
    }
  };

  const getIcon = (type: ContextType["type"]) => {
    switch (type) {
      case "website":
        return <Globe className="h-4 w-4" />;
      case "document":
        return <File className="h-4 w-4" />;
      default:
        return <Library className="h-4 w-4" />;
    }
  };

  if (isLoading) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        Loading context library...
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Context Library</h2>
        <Dialog open={isOpen} onOpenChange={setIsOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="h-4 w-4 mr-2" />
              Add Context
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add New Context</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Title</label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Enter context title"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Type</label>
                <Select value={type} onValueChange={(v: ContextType["type"]) => setType(v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="knowledge_base">Knowledge Base</SelectItem>
                    <SelectItem value="website">Website Content</SelectItem>
                    <SelectItem value="document">Document</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {type === "website" ? (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Website URL</label>
                  <Input
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder="https://example.com"
                    type="url"
                  />
                </div>
              ) : type === "document" ? (
                <div className="space-y-4">
                  <div
                    {...getRootProps()}
                    className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
                      isDragActive ? "border-primary bg-primary/5" : "border-border"
                    }`}
                  >
                    <input {...getInputProps()} />
                    <Upload className="mx-auto h-8 w-8 text-muted-foreground" />
                    <p className="mt-2 text-sm text-muted-foreground">
                      Drag & drop a document here, or click to select
                    </p>
                    <p className="text-xs text-muted-foreground mt-1">
                      Supported formats: PDF, DOC, DOCX, XLS, XLSX
                    </p>
                  </div>
                  {uploadProgress > 0 && (
                    <div className="space-y-2">
                      <Progress value={uploadProgress} />
                      <p className="text-sm text-muted-foreground text-center">
                        Uploading... {uploadProgress}%
                      </p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Content</label>
                  <Textarea
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder="Enter context content"
                    rows={6}
                  />
                </div>
              )}
              
              <Button type="submit" className="w-full" disabled={createMutation.isPending}>
                {createMutation.isPending ? "Adding..." : "Add Context"}
              </Button>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {contexts?.map((context) => (
          <Card key={context.id}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                {context.title}
              </CardTitle>
              <Button
                variant="ghost"
                size="icon"
                className="text-destructive hover:text-destructive/90"
                onClick={() => deleteMutation.mutate(context.id)}
                disabled={deleteMutation.isPending}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </CardHeader>
            <CardContent>
              <CardDescription className="flex items-center gap-2 text-xs">
                {getIcon(context.type)}
                <span className="capitalize">{context.type.replace("_", " ")}</span>
              </CardDescription>
              <p className="mt-2 text-sm text-muted-foreground line-clamp-3">
                {context.content}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

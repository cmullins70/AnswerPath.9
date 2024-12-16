import { useState } from "react";
import { DocumentUpload } from "@/components/DocumentUpload";
import { DocumentList } from "@/components/DocumentList";
import { ProcessingStatus } from "@/components/ProcessingStatus";
import { QuestionList } from "@/components/QuestionList";
import { ContextLibrary } from "@/components/ContextLibrary";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export default function Home() {
  const [activeTab, setActiveTab] = useState("documents");
  
  return (
    <div className="min-h-screen bg-background p-6">
      <div className="container mx-auto">
        <h1 className="text-4xl font-bold mb-8 bg-gradient-to-r from-primary to-primary/70 bg-clip-text text-transparent">
          RFI Assistant
        </h1>

        <div className="grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Document Upload</CardTitle>
            </CardHeader>
            <CardContent>
              <DocumentUpload onUploadSuccess={() => setActiveTab("processing")} />
            </CardContent>
          </Card>

          <Tabs defaultValue="documents" value={activeTab} onValueChange={setActiveTab}>
            <TabsList className="grid w-full grid-cols-4 lg:w-[500px]">
              <TabsTrigger value="documents">Documents</TabsTrigger>
              <TabsTrigger value="processing">Processing</TabsTrigger>
              <TabsTrigger value="questions">Questions</TabsTrigger>
              <TabsTrigger value="context">Context</TabsTrigger>
            </TabsList>

            <TabsContent value="documents">
              <Card>
                <CardHeader>
                  <CardTitle>Uploaded Documents</CardTitle>
                </CardHeader>
                <CardContent>
                  <DocumentList />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="processing">
              <Card>
                <CardHeader>
                  <CardTitle>Processing Status</CardTitle>
                </CardHeader>
                <CardContent>
                  <ProcessingStatus />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="questions">
              <Card>
                <CardHeader>
                  <CardTitle>Extracted Questions</CardTitle>
                </CardHeader>
                <CardContent>
                  <QuestionList />
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="context">
              <Card>
                <CardHeader>
                  <CardTitle>Context Library</CardTitle>
                </CardHeader>
                <CardContent>
                  <ContextLibrary />
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}

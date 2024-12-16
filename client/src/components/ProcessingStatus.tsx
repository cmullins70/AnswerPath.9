import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { ProcessingStatusType, DocumentType } from "@/lib/types";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle2, Circle, Clock, HelpCircle } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export function ProcessingStatus() {
  const { data: documents, isLoading: isLoadingDocuments } = useQuery<DocumentType[]>({
    queryKey: ["/api/documents"],
  });

  const processingDocuments = documents?.filter(doc => doc.status === 'processing') ?? [];
  
  const { data: status, isLoading: isLoadingStatus } = useQuery<ProcessingStatusType>({
    queryKey: ["/api/processing/status", processingDocuments[0]?.id],
    enabled: processingDocuments.length > 0,
    refetchInterval: processingDocuments.length > 0 ? 1000 : false, // Poll every second while processing
  });

  if (isLoadingDocuments || isLoadingStatus) {
    return (
      <div className="text-center py-8">
        <Progress value={0} />
        <p className="text-sm text-muted-foreground mt-2">Loading status...</p>
      </div>
    );
  }

  const steps = [
    {
      id: "extraction",
      label: "Content Extraction",
      description: "Converting document contents into processable text"
    },
    {
      id: "questions",
      label: "Question Identification",
      description: "Detecting explicit and implicit questions in the document"
    },
    {
      id: "analysis",
      label: "Context Analysis",
      description: "Analyzing document context and preparing knowledge base"
    },
    {
      id: "generation",
      label: "Answer Generation",
      description: "Generating accurate responses with source references"
    },
  ];

  if (processingDocuments.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No documents are currently being processed
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Progress
          value={
            status
              ? status.currentStep === "error"
                ? 100
                : status.progress
              : 0
          }
        />
        <span className="text-sm font-medium">
          {status?.progress || 0}%
        </span>
      </div>

      <div className="grid gap-4">
        {steps.map((step) => {
          const isActive = status?.currentStep === step.id;
          const isComplete = status?.completedSteps.includes(step.id);

          return (
            <Card key={step.id}>
              <CardContent className="p-4">
                <div className="flex items-center">
                  {isComplete ? (
                    <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />
                  ) : isActive ? (
                    <Clock className="h-5 w-5 text-blue-500 animate-pulse flex-shrink-0" />
                  ) : (
                    <Circle className="h-5 w-5 text-gray-300 flex-shrink-0" />
                  )}
                  <div className="ml-3 flex-grow">
                    <div className="flex items-center gap-2">
                      <h4 className="font-medium">{step.label}</h4>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger>
                            <HelpCircle className="h-4 w-4 text-muted-foreground" />
                          </TooltipTrigger>
                          <TooltipContent>
                            <p>{step.description}</p>
                            {step.id === "extraction" && (
                              <p>Handles multiple file formats and structures</p>
                            )}
                            {step.id === "questions" && (
                              <p>Uses AI to identify both direct and indirect questions</p>
                            )}
                            {step.id === "analysis" && (
                              <p>Links questions with relevant context and requirements</p>
                            )}
                            {step.id === "generation" && (
                              <p>Generates accurate responses with confidence scores</p>
                            )}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                    <p className="text-sm text-muted-foreground mt-1">
                      {step.description}
                    </p>
                  </div>
                  {isActive && (
                    <span className="ml-auto text-sm text-blue-500 font-medium">
                      In Progress...
                    </span>
                  )}
                  {status?.currentStep === "error" && step.id === "extraction" && (
                    <span className="ml-auto text-sm text-destructive font-medium">
                      Processing Failed
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}

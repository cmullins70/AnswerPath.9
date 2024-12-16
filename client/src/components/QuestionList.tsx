import { useQuery } from "@tanstack/react-query";
import { QuestionType } from "@/lib/types";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";

export function QuestionList() {
  const { data: questions, isLoading, isError } = useQuery<QuestionType[]>({
    queryKey: ["/api/questions"],
    refetchInterval: 5000, // Refetch every 5 seconds while questions are being processed
  });

  if (isLoading) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        Loading questions...
      </div>
    );
  }

  if (isError) {
    return (
      <div className="text-center py-8 text-destructive">
        Error loading questions. Please try again later.
      </div>
    );
  }

  if (!questions?.length) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        No questions have been extracted yet.
        {/* Add guidance */}
        <p className="mt-2 text-sm">
          Upload a document in the Documents tab to start extracting questions.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <span className="text-sm text-muted-foreground">
          {questions.length} question{questions.length !== 1 ? 's' : ''} found
        </span>
        <Button>
          <Download className="mr-2 h-4 w-4" />
          Export Responses
        </Button>
      </div>

      <Accordion type="single" collapsible className="w-full">
        {questions.map((question) => (
          <AccordionItem key={question.id} value={question.id}>
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center gap-4 text-left">
                <span>{question.text}</span>
                <Badge
                  variant={
                    question.confidence > 0.8
                      ? "default"
                      : question.confidence > 0.5
                      ? "secondary"
                      : "destructive"
                  }
                >
                  {Math.round(question.confidence * 100)}% confident
                </Badge>
                <Badge variant="outline">{question.type}</Badge>
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-4 p-4">
                <div>
                  <h4 className="font-medium mb-2">Generated Answer</h4>
                  <p className="text-muted-foreground whitespace-pre-wrap">
                    {question.answer}
                  </p>
                </div>
                <div>
                  <h4 className="font-medium mb-2">Source Document</h4>
                  <p className="text-sm text-muted-foreground">
                    {question.sourceDocument}
                  </p>
                </div>
              </div>
            </AccordionContent>
          </AccordionItem>
        ))}
      </Accordion>
    </div>
  );
}

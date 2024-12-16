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
  const { data: questions } = useQuery<QuestionType[]>({
    queryKey: ["/api/questions"],
  });

  return (
    <div className="space-y-6">
      <div className="flex justify-end">
        <Button>
          <Download className="mr-2 h-4 w-4" />
          Export Responses
        </Button>
      </div>

      <Accordion type="single" collapsible>
        {questions?.map((question) => (
          <AccordionItem key={question.id} value={question.id}>
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center gap-4">
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
              </div>
            </AccordionTrigger>
            <AccordionContent>
              <div className="space-y-4 p-4">
                <div>
                  <h4 className="font-medium mb-2">Generated Answer</h4>
                  <p className="text-muted-foreground">{question.answer}</p>
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

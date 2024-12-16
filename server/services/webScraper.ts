import * as cheerio from "cheerio";
import fetch from "node-fetch";

export class WebScraper {
  private static readonly ALLOWED_TAGS = ["p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "td", "th", "div"];

  async scrapeWebsite(url: string): Promise<{ title: string; content: string }> {
    try {
      console.log(`Starting to scrape website: ${url}`);
      
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch URL: ${response.statusText}`);
      }

      const html = await response.text();
      const $ = cheerio.load(html);

      // Extract the title
      const title = $("title").text().trim() || url;

      // Remove script tags and styles
      $("script").remove();
      $("style").remove();
      $("nav").remove();
      $("footer").remove();
      $("header").remove();

      // Extract main content
      let content = "";
      WebScraper.ALLOWED_TAGS.forEach(tag => {
        $(tag).each((_: number, element: cheerio.Element) => {
          const text = $(element).text().trim();
          if (text && text.length > 20) { // Filter out small snippets
            content += text + "\n\n";
          }
        });
      });

      // Clean up the content
      content = content
        .replace(/\s+/g, " ")
        .replace(/\n\s*\n/g, "\n\n")
        .trim();

      console.log(`Successfully scraped website. Title: ${title}`);
      console.log(`Content length: ${content.length} characters`);

      return {
        title,
        content
      };
    } catch (error) {
      console.error("Error scraping website:", error);
      throw error;
    }
  }

  // Validate URL format
  validateUrl(url: string): boolean {
    try {
      new URL(url);
      return true;
    } catch {
      return false;
    }
  }
}

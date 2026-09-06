import { Controller, Get, Header, HttpException, Query } from "@nestjs/common";

import { ReferenceError } from "../../../../web/src/shared/lib/kmas-reference";
import { searchKmasReferences } from "../../server/kmas-reference";

@Controller()
export class KmasReferenceController {
  @Get("/kmas/references")
  @Header("Cache-Control", "no-store")
  async search(@Query() query: Record<string, unknown>) {
    try {
      return await searchKmasReferences(query);
    } catch (error) {
      const failure = error instanceof ReferenceError ? error : new ReferenceError("KMAS_UNAVAILABLE", 502);
      // Never send upstream messages or URLs: their query strings contain prvKey.
      throw new HttpException({ code: failure.code }, failure.status);
    }
  }
}

import { trigger, transition, query, style, stagger, animate, keyframes, group, state } from '@angular/animations';
import { AfterViewInit, ChangeDetectionStrategy, Component, ElementRef, OnInit, Renderer2, ViewChild } from '@angular/core';
import { MatPaginator, PageEvent } from '@angular/material/paginator';
import { Router } from '@angular/router';
import { Subject, BehaviorSubject, Observable, of } from 'rxjs';
import { delay, map, mergeAll, take, takeUntil, tap, toArray } from 'rxjs/operators';
import { EmoteListService } from 'src/app/emotes/emote-list/emote-list.service';
import { AppService } from 'src/app/service/app.service';
import { LocalStorageService } from 'src/app/service/localstorage.service';
import { RestService } from 'src/app/service/rest.service';
import { RestV2 } from 'src/app/service/rest/rest-v2.structure';
import { ThemingService } from 'src/app/service/theming.service';
import { WindowRef } from 'src/app/service/window.service';
import { EmoteStructure } from 'src/app/util/emote.structure';

@Component({
	selector: 'app-emote-list',
	templateUrl: './emote-list.component.html',
	styleUrls: ['./emote-list.component.scss'],
	styles: ['.selected-emote-card { opacity: 0 }'],
	animations: [
		trigger('fadeout', [
			state('true', style({ transform: 'translateY(200%)', opacity: 0 })),

			transition('* => true', animate('100ms'))
		]),

		trigger('emotes', [
			transition('* => *', [
				query('.is-emote-card:enter', [
					style({ opacity: 0, transform: 'translateX(5em) translateY(-20em)' }),
					stagger(9, [
						animate('475ms ease-in-out', keyframes([
							style({ opacity: 0, offset: 0.475 }),
							style({ opacity: 1, transform: 'none', offset: 1 })
						]))
					])
				], { optional: true }),

				group([
					query('.is-emote-card:not(.selected-emote-card):leave', [
						style({ opacity: 1 }),
						stagger(-6, [
							animate('200ms', style({ transform: 'scale(0)' }))
						])
					], { optional: true }),

					query('.selected-emote-card', [
						style({ opacity: 1 }),
						animate('550ms', keyframes([
							style({ offset: 0, opacity: 1, transform: 'scale(1)' }),
							style({ offset: .2, transform: 'scale(.91)' }),
							style({ offset: .38, transform: 'scale(.64)' }),
							style({ offset: .44, transform: 'scale(.82)' }),

							style({ offset: 1, transform: 'scale(12) translateY(25%)', opacity: 0 })
						])),
					], { optional: true })
				])
			])
		])
	],
	changeDetection: ChangeDetectionStrategy.OnPush
})
export class EmoteListComponent implements OnInit, AfterViewInit {
	destroyed = new Subject<any>().pipe(take(1)) as Subject<void>;
	selecting = new BehaviorSubject(false).pipe(takeUntil(this.destroyed)) as BehaviorSubject<boolean>;
	emotes = new BehaviorSubject<any>(Array(16).fill(new EmoteStructure(this.restService))).pipe(takeUntil(this.destroyed)) as BehaviorSubject<EmoteStructure[]>;
	totalEmotes = new BehaviorSubject<number>(0);
	contextEmote: EmoteStructure | null = null;

	@ViewChild('emotesContainer') emotesContainer: ElementRef<HTMLDivElement> | undefined;
	@ViewChild(MatPaginator, { static: true }) paginator: MatPaginator | undefined;
	pageOptions: EmoteListComponent.PersistentPageOptions | undefined;
	pageSize = new BehaviorSubject<number>(16);
	currentSearchOptions: RestV2.GetEmotesOptions | undefined;
	currentSearchQuery = '';

	contextMenuOptions = [
		{
			label: 'Open in New Tab',
			icon: 'open_in_new',
			click: emote => {
				const url = this.router.serializeUrl(this.router.createUrlTree(['/emotes', String(emote.getID())]));

				return of(this.windowRef.getNativeWindow()?.open(url, '_blank'));
			}
		},
		{
			label: 'Copy Link',
			icon: 'link',
			click: emote => of(this.windowRef.copyValueToClipboard(''.concat(
				`https://${this.windowRef.getNativeWindow()?.location.host}`, // Get window location.host
				this.router.serializeUrl(this.router.createUrlTree(['/emotes', String(emote.getID())]))
			)))
		},
		...this.emoteListService.interactions
	] as EmoteListService.InteractButton[];

	constructor(
		private restService: RestService,
		private renderer: Renderer2,
		private router: Router,
		private windowRef: WindowRef,
		private appService: AppService,
		private localStorage: LocalStorageService,
		private emoteListService: EmoteListService,
		public themingService: ThemingService
	) { }

	onContextInteract(button: EmoteListService.InteractButton, emote: EmoteStructure): void {
		if (typeof button.click === 'function' && !!emote) {
			button.click(emote).subscribe();
		}
	}

	selectEmote(el: any, emote: EmoteStructure): void {
		if (!emote.getID()) return undefined;

		this.selecting.next(true);
		this.renderer.addClass(el, 'selected-emote-card');
		this.emotes.next([]);

		setTimeout(() => {
			this.router.navigate(['emotes', emote.getID()]);
		}, 775);
	}

	handleSearchChange(change: Partial<RestV2.GetEmotesOptions>): void {
		const queryString = Object.keys(change).map(k => `${k}=${change[k as keyof RestV2.GetEmotesOptions]}`).join('&');

		this.appService.pushTitleAttributes({ name: 'SearchOptions', value: `- ${queryString}` });

		this.currentSearchOptions = { ...this.currentSearchOptions, ...change as RestV2.GetEmotesOptions };
		this.getEmotes(undefined, undefined, this.currentSearchOptions).pipe(
			toArray(),
			tap(() => this.emotes.next([])),
			delay(50),
			tap(emotes => this.emotes.next(emotes))
		).subscribe();
	}

	getEmotes(page = 1, pageSize = 16, options?: Partial<RestV2.GetEmotesOptions>): Observable<EmoteStructure> {
		return this.restService.v2.SearchEmotes((this.pageOptions?.page ?? (page - 1)) + 1, this.pageOptions?.pageSize ?? pageSize, options ?? this.currentSearchOptions).pipe(
			tap(res => this.totalEmotes.next(res?.total_estimated_size ?? 0)),
			tap(() => this.emotes.next([])),
			delay(200),
			map(res => res?.emotes ?? []),
			mergeAll(),
			map(data => new EmoteStructure(this.restService).pushData(data))
		);
	}

	/**
	 * Handle pagination changes
	 */
	onPageEvent(ev: PageEvent): void {
		// Save page options to localstorage
		const pageOptions = this.pageOptions = {
			page: ev.pageIndex,
			pageSize: ev.pageSize,
			length: ev.length
		} as EmoteListComponent.PersistentPageOptions;
		this.localStorage.setItem('pagination', JSON.stringify(pageOptions));

		// Save PageIndex title attr
		this.appService.pushTitleAttributes({ name: 'PageIndex', value: `- ${ev.pageIndex + 1}/${Number((ev.length / ev.pageSize).toFixed(0)) + 1}` });

		// Fetch new set of emotes
		this.getEmotes(ev.pageIndex + 1, ev.pageSize).pipe(
			toArray(),
			tap(emotes => this.emotes.next(emotes))
		).subscribe();
	}

	/**
	 * Calculate how many rows and columns according to the container's size
	 *
	 * @returns the result of rows * columns
	 */
	calculateSizedRows(): number | null {
		if (!this.emotesContainer) {
			return null;
		}

		const marginBuffer = 28; // The margin _in pixels between each card
		const cardSize = 140; // The size of the cards in pixels
		const width = this.emotesContainer.nativeElement.scrollWidth - 32; // The width of emotes container
		const height = this.emotesContainer.nativeElement.scrollHeight - 16; // The height of the emotes container

		const rows = Math.floor((width / (cardSize + marginBuffer))); // The calculated amount of rows
		const columns = Math.floor(height / (cardSize + marginBuffer)); // The calculated amount of columns

		// Return the result of rows multiplied by columns
		return rows * columns;
	}

	ngAfterViewInit(): void {
		const pageSize = this.calculateSizedRows() ?? 0;
		this.pageSize.next(pageSize);

		this.currentSearchOptions = {
			sortBy: this.emoteListService.searchForm.get('sortBy')?.value,
			sortOrder: this.emoteListService.searchForm.get('sortOrder')?.value,
		} as RestV2.GetEmotesOptions;

		// Get persisted page options?
		const pageOptions = this.localStorage.getItem('pagination');
		if (!!pageOptions) { // If persistence options found set the page
			const o = JSON.parse(pageOptions) as EmoteListComponent.PersistentPageOptions; // Parse JSON from localStorage

			this.paginator?.page.next({
				pageIndex: o.page,
				pageSize: o.pageSize,
				length: o.length,
			});
			this.pageOptions = o;
		} else {
			this.getEmotes(1, pageSize).pipe(
				toArray(),
				map(emotes => this.emotes.next(emotes))
			).subscribe();
		}
	}

	ngOnInit(): void {}

}

export namespace EmoteListComponent {
	export interface PersistentPageOptions {
		pageSize: number;
		page: number;
		length: number;
	}
}

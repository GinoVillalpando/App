import { HttpClient, HttpErrorResponse, HttpProgressEvent, HttpResponse } from '@angular/common/http';
import { Inject, Injectable, PLATFORM_ID } from '@angular/core';
import { CookieService } from 'ngx-cookie-service';
import { BehaviorSubject, EMPTY, iif, Observable, of, throwError } from 'rxjs';
import { filter, map, switchMap, take, tap } from 'rxjs/operators';
import { ClientService } from 'src/app/service/client.service';
import { LocalStorageService } from 'src/app/service/localstorage.service';
import { EgVault } from 'src/app/service/rest/egvault.structure';
import { RestV1 } from 'src/app/service/rest/rest-v1.structure';
import { RestV2 } from 'src/app/service/rest/rest-v2.structure';
import { environment } from 'src/environments/environment';

@Injectable({
	providedIn: 'root'
})
export class RestService {
	BASE = {
		v1: '',
		v2: '',
		egvault: ''
	} as { [key in RestService.ApiVersion]: string };
	private CDN_BASE = environment.cdnUrl;

	public v1 = new RestV1(this);
	public v2 = new RestV2(this);
	public egvault = new EgVault(this);

	authenticating = new BehaviorSubject<boolean>(true);

	constructor(
		@Inject(PLATFORM_ID) private platformId: any,
		cookieService: CookieService,
		localStorage: LocalStorageService,
		public httpService: HttpClient,
		public clientService: ClientService
	) {
		this.BASE.v1 = environment.platformApiUrl('v1');
		this.BASE.v2 = environment.platformApiUrl('v2');
		this.BASE.egvault = environment.platformApiUrl('egvault');

		setTimeout(() => {
			if (platformId === 'browser') {
				// Sign in the user?
				const token = localStorage.getItem('access_token') ?? cookieService.get('auth');
				of(token).pipe(
					filter(x => typeof x === 'string'),
					tap(tok => clientService.setToken(tok)),
					switchMap(() => this.v2.GetUser('@me', { includeEditorIn: true }, [
						'notification_count',
						`notifications {
							id, read, title, announcement,
							users {
								id, login, display_name,
								profile_image_url,
								role { id, color }
							},
							emotes {
								id, name
							},
							message_parts {
								type, data
							}
						}`
					])),
					switchMap(res => !!res.user?.id ? of(res.user) : throwError('Unknown Account')),
					tap(user => clientService.pushData(user))
				).subscribe({
					error: () => this.authenticating.next(false),
					complete: () => this.authenticating.next(false)
				});
			} else {
				this.authenticating.next(false);
			}
		}, 0);
	}

	awaitAuth(): Observable<boolean> {
		return this.authenticating.pipe(
			filter(b => b === false),
			take(1),

			switchMap(() => this.clientService.isAuthenticated().pipe(take(1)))
		);
	}

	// tslint:disable:typedef
	get Discord() {
		return {
			Widget: (guildID = '817075418054000661') => this.createRequest<RestService.Result.GetDiscordWidget>('get', `https://discord.com/api/guilds/${guildID}/widget.json`, {}, 'none')
		};
	}

	get CDN() {
		return {
			Emote: (id: string, size: number) => `${this.CDN_BASE}/emote/${id}/${size}x`
		};
	}
	// tslint:enable:typedef

	createRequest<T>(
		method: RestService.Method,
		route: string,
		options?: Partial<RestService.CreateRequestOptions>,
		apiVersion: RestService.ApiVersion = 'v2'
	): Observable<HttpResponse<T> | HttpProgressEvent> {
		if (this.platformId === 'server' && !options?.runOnSSR) {
			return EMPTY;
		}

		const uri = (route.startsWith('http') ? '' : this.BASE[apiVersion]) + route;
		const opt = {
			observe: 'events',
			headers: {
				...(options?.headers ?? {}),
				Authorization: (options?.auth && this.clientService.getToken()?.length > 0) ? `Bearer ${this.clientService.getToken()}` : ''
			},
			reportProgress: true
		} as any;

		return of(method).pipe(
			switchMap(m => iif(() => (m === 'get') || (m === 'delete'),
				this.httpService[m](uri, opt),
				this.httpService[m as RestService.BodyMethod](uri, options?.body ?? {}, opt)
			))
		).pipe(map((x: any) => x as (HttpResponse<T> | HttpProgressEvent)));
	}

	formatError(err: HttpErrorResponse): string {
		return err.error?.errors?.map((er: any) => er.message) ?? err.error?.error ?? JSON.stringify(err.error) ?? String(err);
	}
}

export namespace RestService {
	export type Method = 'get' | 'patch' | 'post' | 'put' | 'delete';
	export type BodyMethod = 'patch' | 'post' | 'put';

	export type ApiVersion = 'v1' | 'v2' | 'egvault' | 'none';

	export const onlyResponse = () => <T>(source: Observable<HttpResponse<T> | HttpProgressEvent>) => source.pipe(
		filter(x => x instanceof HttpResponse)
	) as Observable<HttpResponse<T>>;

	export interface CreateRequestOptions {
		headers: { [key: string]: string };
		auth: boolean;
		body?: any;
		runOnSSR?: boolean;
	}

	export namespace Result {
		/** GET /auth  */
		export interface GetURLResult {
			url?: string;
		}

		export interface GetDiscordWidget {
			id: string;
			name: string;
			instant_invite: string;
			channels: {
				id: string;
				name: string;
				position: number;
			}[];
			members: {
				id: string;
				username: string;
				discriminator: string;
				status: string;
				avatar_url: string;
			}[];
			presence_count: number;
		}
	}
}

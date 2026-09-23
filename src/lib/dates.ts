const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const TIME_ZONE = 'America/Sao_Paulo';

function saoPaulo(date: Date) {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: TIME_ZONE,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).formatToParts(date);
	const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
	return { year: value('year'), month: Number(value('month')), day: Number(value('day')) };
}

export function cardDate(date: Date) {
	const { year, month, day } = saoPaulo(date);
	return {
		label: `${day} ${MONTHS[month - 1]}`,
		datetime: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
	};
}

export function postDate(date: Date) {
	return {
		label: new Intl.DateTimeFormat('pt-BR', {
			day: 'numeric',
			month: 'long',
			year: 'numeric',
			timeZone: TIME_ZONE,
		}).format(date),
		datetime: cardDate(date).datetime,
	};
}
